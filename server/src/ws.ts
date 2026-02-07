import http from "node:http";
import crypto from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { prisma } from "./config";
import { activeSockets } from "./state";
import {
  clearActiveSocket,
  consumeSessionStart,
  getLatestSessionToken,
  getSessionUserId,
  setActiveSocket,
  setSessionStart,
  setLastSeen
} from "./services/stateService";

type PlayerState = {
  id: string;
  x: number;
  y: number;
  displayName: string;
  avatarUrl: string | null;
};

type ClientMessage =
  | { type: "join"; token: string; x: number; y: number }
  | { type: "input"; x: number; y: number }
  | { type: "speaking"; speaking: boolean }
  | {
      type: "effect";
      effect: { key: "freeze"; radius: number; durationMs: number; includeSelf?: boolean };
    };

type ServerMessage =
  | { type: "welcome"; id: string; players: PlayerState[]; serverTime: string }
  | { type: "playerUpdate"; player: PlayerState }
  | { type: "playerLeft"; id: string }
  | { type: "speaking"; id: string; speaking: boolean }
  | { type: "toast"; text: string }
  | {
      type: "effectState";
      effect: { key: "freeze"; active: boolean; expiresAt?: string };
    }
  | {
      type: "effectCast";
      effect: {
        key: "freeze";
        casterId: string;
        casterName: string;
        casterAvatarUrl: string | null;
        radius: number;
        includeSelf: boolean;
        expiresAt: string;
      };
    }
  | { type: "effectExpired"; key: "freeze" }
  | { type: "inventoryExpired"; itemId: string }
  | {
      type: "effect";
      effect: {
        key: "freeze";
        expiresAt: string;
      };
    }
  | {
      type: "giftReturn";
      gift: {
        giftId: string;
        storeItemId: string;
        reason: "rejected" | "expired";
      };
    }
  | {
      type: "giftOffer";
      gift: {
        id: string;
        fromUserId: string;
        fromName: string;
        fromAvatarUrl: string | null;
        itemId: string;
        itemName: string;
        itemImageUrl: string | null;
        expiresAt: string;
      };
    };

type ConnectionContext = {
  userId: string;
  socket: WebSocket;
  blockedIds: Set<string>;
  blockedByIds: Set<string>;
  freezeUntil?: number;
};

const connections = new Map<string, ConnectionContext>();
const effectTimers = new Map<string, Map<string, NodeJS.Timeout>>();
const userEffectConfig = new Map<
  string,
  { key: "freeze"; radius: number; durationMs: number; includeSelf: boolean; expiresAt: number }
>();
const freezeCasts = new Map<
  string,
  { radius: number; includeSelf: boolean; expiresAt: number }
>();

async function getBlockSets(userId: string) {
  const blocks = await prisma.block.findMany({
    where: {
      OR: [{ blockerId: userId }, { blockedId: userId }]
    }
  });
  const blockedIds = new Set<string>();
  const blockedByIds = new Set<string>();
  for (const block of blocks) {
    if (block.blockerId === userId) blockedIds.add(block.blockedId);
    if (block.blockedId === userId) blockedByIds.add(block.blockerId);
  }
  return { blockedIds, blockedByIds };
}

function canSee(viewer: ConnectionContext, targetId: string) {
  if (viewer.blockedIds.has(targetId)) return false;
  if (viewer.blockedByIds.has(targetId)) return false;
  return true;
}

export async function refreshBlockCacheForUser(userId: string) {
  const context = connections.get(userId);
  if (!context) return;
  const { blockedIds, blockedByIds } = await getBlockSets(userId);
  context.blockedIds = blockedIds;
  context.blockedByIds = blockedByIds;
}

export function notifyBlock(blockerId: string, blockedId: string) {
  const blocker = connections.get(blockerId);
  if (blocker && blocker.socket.readyState === blocker.socket.OPEN) {
    blocker.socket.send(JSON.stringify({ type: "playerLeft", id: blockedId }));
  }
  const blocked = connections.get(blockedId);
  if (blocked && blocked.socket.readyState === blocked.socket.OPEN) {
    blocked.socket.send(JSON.stringify({ type: "playerLeft", id: blockerId }));
  }
}

const players = new Map<string, PlayerState>();

export function notifyAvatarChange(userId: string, avatarUrl: string | null) {
  const player = players.get(userId);
  if (!player) return;
  player.avatarUrl = avatarUrl;
  const message: ServerMessage = { type: "playerUpdate", player };
  const data = JSON.stringify(message);
  for (const context of connections.values()) {
    if (context.socket.readyState !== context.socket.OPEN) continue;
    if (message.type === "playerUpdate") {
      if (!canSee(context, message.player.id)) continue;
    }
    context.socket.send(data);
  }
}

export function notifyToast(userId: string, text: string) {
  const context = connections.get(userId);
  if (!context || context.socket.readyState !== context.socket.OPEN) return;
  context.socket.send(JSON.stringify({ type: "toast", text }));
}

export function notifyGiftReturn(
  userId: string,
  gift: { giftId: string; storeItemId: string; reason: "rejected" | "expired" }
) {
  const context = connections.get(userId);
  if (!context || context.socket.readyState !== context.socket.OPEN) return;
  context.socket.send(JSON.stringify({ type: "giftReturn", gift }));
}

export function notifyInventoryExpired(userId: string, itemId: string) {
  const context = connections.get(userId);
  if (!context || context.socket.readyState !== context.socket.OPEN) return;
  context.socket.send(JSON.stringify({ type: "inventoryExpired", itemId }));
}

export function notifyEffectExpired(userId: string, key: "freeze") {
  const context = connections.get(userId);
  if (!context || context.socket.readyState !== context.socket.OPEN) return;
  context.socket.send(JSON.stringify({ type: "effectExpired", key }));
}

export function scheduleEffectEnd(userId: string, key: "freeze", durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return;
  const existingConfig = userEffectConfig.get(userId);
  if (existingConfig && existingConfig.key === key) {
    existingConfig.expiresAt = Date.now() + durationMs;
  }
  const timers = effectTimers.get(userId) ?? new Map<string, NodeJS.Timeout>();
  const existing = timers.get(key);
  if (existing) {
    clearTimeout(existing);
  }
  const timeout = setTimeout(() => {
    notifyEffectExpired(userId, key);
    const userTimers = effectTimers.get(userId);
    if (userTimers) {
      userTimers.delete(key);
      if (userTimers.size === 0) effectTimers.delete(userId);
    }
    const cfg = userEffectConfig.get(userId);
    if (cfg && cfg.key === key) {
      userEffectConfig.delete(userId);
    }
    freezeCasts.delete(userId);
  }, durationMs);
  timers.set(key, timeout);
  effectTimers.set(userId, timers);
}

export function setUserEffectConfig(
  userId: string,
  config: { key: "freeze"; radius: number; durationMs: number; includeSelf: boolean }
) {
  userEffectConfig.set(userId, {
    ...config,
    expiresAt: Date.now() + Math.max(0, config.durationMs)
  });
}

export function clearUserEffectConfig(userId: string, key: "freeze") {
  const existing = userEffectConfig.get(userId);
  if (existing && existing.key === key) {
    userEffectConfig.delete(userId);
  }
  freezeCasts.delete(userId);
}

function sendActiveEffectsTo(context: ConnectionContext, now: number) {
  for (const [casterId, cfg] of userEffectConfig.entries()) {
    if (cfg.expiresAt <= now) continue;
    if (!canSee(context, casterId)) continue;
    const caster = players.get(casterId);
    if (!caster) continue;
    const message: ServerMessage = {
      type: "effectCast",
      effect: {
        key: "freeze",
        casterId,
        casterName: caster.displayName,
        casterAvatarUrl: caster.avatarUrl ?? null,
        radius: cfg.radius,
        includeSelf: cfg.includeSelf,
        expiresAt: new Date(cfg.expiresAt).toISOString()
      }
    };
    if (context.socket.readyState === context.socket.OPEN) {
      context.socket.send(JSON.stringify(message));
    }
  }
}
export function notifyGiftOffer(
  userId: string,
  gift: {
    id: string;
    fromUserId: string;
    fromName: string;
    fromAvatarUrl: string | null;
    itemId: string;
    itemName: string;
    itemImageUrl: string | null;
    expiresAt: string;
  }
) {
  const context = connections.get(userId);
  if (!context || context.socket.readyState !== context.socket.OPEN) return;
  context.socket.send(JSON.stringify({ type: "giftOffer", gift }));
}

export function notifyFreezeNearby(
  sourceUserId: string,
  radius: number,
  durationMs: number,
  includeSelf = false
) {
  const source = players.get(sourceUserId);
  if (!source) return;
  freezeCasts.set(sourceUserId, {
    radius,
    includeSelf,
    expiresAt: Date.now() + durationMs
  });
  const castMessage: ServerMessage = {
    type: "effectCast",
    effect: {
      key: "freeze",
      casterId: sourceUserId,
      casterName: source.displayName,
      casterAvatarUrl: source.avatarUrl ?? null,
      radius,
      includeSelf,
      expiresAt: new Date(Date.now() + durationMs).toISOString()
    }
  };
  const castData = JSON.stringify(castMessage);
  for (const context of connections.values()) {
    if (context.socket.readyState !== context.socket.OPEN) continue;
    if (!canSee(context, sourceUserId)) continue;
    context.socket.send(castData);
  }
}

function tickFreezeFields() {
  const now = Date.now();
  for (const [casterId, cast] of freezeCasts.entries()) {
    if (cast.expiresAt <= now) {
      freezeCasts.delete(casterId);
    }
  }
  for (const context of connections.values()) {
    if (context.socket.readyState !== context.socket.OPEN) continue;
    const target = players.get(context.userId);
    if (!target) continue;
    let maxUntil = 0;
    for (const [casterId, cast] of freezeCasts.entries()) {
      if (!cast.includeSelf && casterId === context.userId) continue;
      const caster = players.get(casterId);
      if (!caster) continue;
      if (!canSee(context, casterId)) continue;
      const dx = target.x - caster.x;
      const dy = target.y - caster.y;
      if (dx * dx + dy * dy <= cast.radius * cast.radius) {
        maxUntil = Math.max(maxUntil, cast.expiresAt);
      }
    }
    const active = maxUntil > now;
    const prev = context.freezeUntil ?? 0;
    if ((active && maxUntil !== prev) || (!active && prev !== 0)) {
      context.freezeUntil = active ? maxUntil : 0;
      const message: ServerMessage = {
        type: "effectState",
        effect: {
          key: "freeze",
          active,
          expiresAt: active ? new Date(maxUntil).toISOString() : undefined
        }
      };
      context.socket.send(JSON.stringify(message));
    }
  }
}

export function attachWebsocket(server: http.Server) {
  const wss = new WebSocketServer({ server });
  const freezeTimer = setInterval(() => {
    tickFreezeFields();
  }, 150);

  const broadcast = (message: ServerMessage) => {
    const data = JSON.stringify(message);
    for (const context of connections.values()) {
      if (context.socket.readyState !== context.socket.OPEN) continue;
      if (message.type === "playerUpdate") {
        if (!canSee(context, message.player.id)) continue;
      }
      if (message.type === "playerLeft") {
        if (!canSee(context, message.id)) continue;
      }
      if (message.type === "speaking") {
        if (!canSee(context, message.id)) continue;
      }
      if (message.type === "toast") {
        // toast is targeted to a single socket, no visibility filter
      }
      context.socket.send(data);
    }
  };

  wss.on("connection", (socket, req) => {
    const socketId = crypto.randomUUID();
    let userId: string | null = null;
    let displayName = "Guest";
    let avatarUrl: string | null = null;

    socket.on("message", (raw) => {
      let msg: ClientMessage | null = null;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "join") {
        void (async () => {
          const userIdFromToken = await getSessionUserId(msg.token);
          if (!userIdFromToken) {
            socket.close();
            return;
          }
          const latestToken = await getLatestSessionToken(userIdFromToken);
          if (latestToken !== msg.token) {
            socket.close();
            return;
          }
          userId = userIdFromToken;

          const user = await prisma.user.findUnique({ where: { id: userId! } });
          displayName = user?.nickname ?? user?.phone ?? "Guest";
          avatarUrl = user?.avatarUrl ?? null;

          const player: PlayerState = {
            id: userId!,
            x: msg.x,
            y: msg.y,
            displayName,
            avatarUrl
          };
          players.set(userId!, player);
          const existingSocket = activeSockets.get(userId!);
          if (existingSocket && existingSocket !== socket) {
            existingSocket.close();
          }
          activeSockets.set(userId!, socket);
          await setActiveSocket(userId!, socketId);
          await setSessionStart(userId!);

          const blockSets = await getBlockSets(userId!);
          connections.set(userId!, {
            userId: userId!,
            socket,
            blockedIds: blockSets.blockedIds,
            blockedByIds: blockSets.blockedByIds
          });

          const context = connections.get(userId!);
          const visiblePlayers = Array.from(players.values()).filter((p) =>
            context ? canSee(context, p.id) : true
          );
          const welcome: ServerMessage = {
            type: "welcome",
            id: userId!,
            players: visiblePlayers,
            serverTime: new Date().toISOString()
          };
          socket.send(JSON.stringify(welcome));
          broadcast({ type: "playerUpdate", player });
          const current = connections.get(userId!);
          if (current) {
            sendActiveEffectsTo(current, Date.now());
          }
        })();
        return;
      }

      if (msg.type === "input" && userId) {
        const player = players.get(userId);
        if (!player) return;
        player.x = msg.x;
        player.y = msg.y;
        void setActiveSocket(userId, socketId);
        broadcast({ type: "playerUpdate", player });
      }

      if (msg.type === "speaking" && userId) {
        broadcast({ type: "speaking", id: userId, speaking: !!msg.speaking });
        return;
      }

      if (msg.type === "effect" && userId) {
        if (msg.effect.key !== "freeze") return;
        const stored = userEffectConfig.get(userId);
        const radius = Math.max(
          40,
          Math.min(400, Number(stored?.radius ?? msg.effect.radius) || 120)
        );
        const durationMs = Math.max(
          500,
          Math.min(10000, Number(stored?.durationMs ?? msg.effect.durationMs) || 3000)
        );
        const includeSelf = stored?.includeSelf ?? true;
        notifyFreezeNearby(userId, radius, durationMs, includeSelf);
      }
    });

    socket.on("close", () => {
      if (!userId) return;
      if (players.has(userId)) {
        players.delete(userId);
        broadcast({ type: "playerLeft", id: userId });
      }
      connections.delete(userId);
      if (activeSockets.get(userId) === socket) {
        activeSockets.delete(userId);
      }
      void (async () => {
        await clearActiveSocket(userId!);
        await setLastSeen(userId!);
        const started = await consumeSessionStart(userId!);
        const elapsed = started
          ? Math.max(0, Math.floor((Date.now() - started) / 1000))
          : 0;
        await prisma.user.update({
          where: { id: userId! },
          data: {
            gameplaySeconds: { increment: elapsed }
          }
        });
      })();
    });
  });

  wss.on("close", () => {
    clearInterval(freezeTimer);
  });
}
