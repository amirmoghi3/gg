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
  | { type: "speaking"; speaking: boolean };

type ServerMessage =
  | { type: "welcome"; id: string; players: PlayerState[] }
  | { type: "playerUpdate"; player: PlayerState }
  | { type: "playerLeft"; id: string }
  | { type: "speaking"; id: string; speaking: boolean }
  | { type: "toast"; text: string }
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
};

const connections = new Map<string, ConnectionContext>();

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

export function attachWebsocket(server: http.Server) {
  const wss = new WebSocketServer({ server });

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
            players: visiblePlayers
          };
          socket.send(JSON.stringify(welcome));
          broadcast({ type: "playerUpdate", player });
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
}
