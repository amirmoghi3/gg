import { Router } from "express";
import { prisma } from "../config";
import { getAuthedUser } from "../services/userService";
import { getLastSeen, isOnline, tryConsumeCooldown } from "../services/stateService";
import { scheduleEffectEnd, setUserEffectConfig, clearUserEffectConfig } from "../ws";

export const inventoryRouter = Router();

inventoryRouter.get("/", async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) {
    res.status(401).send("Unauthorized");
    return;
  }
  const now = new Date();
  const items = await prisma.inventoryItem.findMany({
    where: {
      userId: user.id
    },
    include: {
      storeItem: {
        include: { effects: { include: { effect: true } } }
      }
    },
    orderBy: { updatedAt: "desc" }
  });
  const gifts = await prisma.gift.findMany({
    where: { toUserId: user.id },
    include: {
      fromUser: {
        select: {
          id: true,
          nickname: true,
          avatarUrl: true
        }
      }
    }
  });

  const senderMap = new Map<
    string,
    Map<string, { count: number; user: { id: string; nickname: string | null; avatarUrl: string | null } | null }>
  >();

  for (const gift of gifts) {
    const key = gift.storeItemId;
    const senderKey = gift.fromUserId ?? "store";
    const store = senderMap.get(key) ?? new Map();
    const existing = store.get(senderKey) ?? {
      count: 0,
      user: gift.fromUserId ? gift.fromUser : null
    };
    existing.count += 1;
    store.set(senderKey, existing);
    senderMap.set(key, store);
  }

  const response = await Promise.all(
    items.map(async (item) => {
      const senders = senderMap.get(item.storeItemId);
      const senderEntries = senders
        ? Array.from(senders.entries()).map(([id, data]) => ({
            id: id === "store" ? null : id,
            name: data.user?.nickname ?? (id === "store" ? "Store" : "User"),
            avatarUrl: data.user?.avatarUrl ?? null,
            count: data.count
          }))
        : [];

      const withPresence = await Promise.all(
        senderEntries.map(async (sender) => {
          if (!sender.id) {
            return { ...sender, isOnline: false, lastSeen: null };
          }
          const online = await isOnline(sender.id);
          const lastSeen = online ? null : await getLastSeen(sender.id);
          return { ...sender, isOnline: online, lastSeen };
        })
      );

      const isExpired = !!item.expiresAt && item.expiresAt <= now;
      return {
        ...item,
        isExpired,
        senders: withPresence
      };
    })
  );

  res.json(response);
});

inventoryRouter.post("/equip", async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) {
    res.status(401).send("Unauthorized");
    return;
  }
  const inventoryItemId = String(req.body?.inventoryItemId ?? "");
  const equipped = req.body?.equipped;
  if (!inventoryItemId || typeof equipped !== "boolean") {
    res.status(400).send("Invalid payload");
    return;
  }
  const item = await prisma.inventoryItem.findUnique({
    where: { id: inventoryItemId },
    include: {
      storeItem: {
        include: { effects: { include: { effect: true } } }
      }
    }
  });
  if (!item || item.userId !== user.id) {
    res.status(404).send("Not found");
    return;
  }
  if (!item.storeItem.isEquippable && equipped) {
    res.status(400).send("Item not equippable");
    return;
  }
  const now = new Date();
  if (item.expiresAt && item.expiresAt <= now) {
    await prisma.inventoryItem.delete({ where: { id: item.id } });
    res.status(410).send("Item expired");
    return;
  }
  if (equipped) {
    const existing = await prisma.inventoryItem.findFirst({
      where: {
        userId: user.id,
        isEquipped: true,
        expiresAt: { not: null, gt: now },
        NOT: { id: item.id }
      },
      select: { expiresAt: true }
    });
    if (existing?.expiresAt) {
      const retryAfter = Math.max(
        1,
        Math.ceil((existing.expiresAt.getTime() - now.getTime()) / 1000)
      );
      res.status(409).json({ error: "equip_locked", retryAfter });
      return;
    }
  }
  let expiresAt: Date | null = null;
  let effectDurationMs = 0;
  let effectRadius = 120;
  let includeSelf = true;
  if (equipped) {
    const durations = (item.storeItem.effects ?? []).map((e) => {
      const config = e.effect.config as { durationMs?: number } | null | undefined;
      const rawRadius = (e.effect.config as { radius?: number } | null | undefined)?.radius;
      if (typeof rawRadius === "number") {
        effectRadius = rawRadius;
      }
      const rawInclude = (e.effect.config as { includeSelf?: boolean } | null | undefined)
        ?.includeSelf;
      if (typeof rawInclude === "boolean") {
        includeSelf = rawInclude;
      }
      if (typeof config?.durationMs === "number" && config.durationMs > 0) {
        effectDurationMs = Math.max(effectDurationMs, config.durationMs);
        return Math.ceil(config.durationMs / 1000);
      }
      return e.effect.durationSeconds ?? 0;
    }).filter((n) => typeof n === "number" && n > 0);
    const maxSeconds = durations.length > 0 ? Math.max(...durations) : 0;
    if (maxSeconds > 0) {
      expiresAt = new Date(Date.now() + maxSeconds * 1000);
      if (!effectDurationMs) effectDurationMs = maxSeconds * 1000;
    }
    const cooldownSeconds = maxSeconds > 0 ? maxSeconds : 0;
    if (cooldownSeconds > 0) {
      const cooldown = await tryConsumeCooldown(user.id, "effect:global", cooldownSeconds);
      if (!cooldown.allowed) {
        res.status(429).json({ error: "effect_cooldown", retryAfter: cooldown.retryAfter });
        return;
      }
    }
  }
  await prisma.inventoryItem.update({
    where: { id: inventoryItemId },
    data: { isEquipped: equipped, expiresAt }
  });
  if (equipped && effectDurationMs > 0) {
    scheduleEffectEnd(user.id, "freeze", effectDurationMs);
    setUserEffectConfig(user.id, {
      key: "freeze",
      radius: effectRadius,
      durationMs: effectDurationMs,
      includeSelf
    });
  } else if (!equipped) {
    clearUserEffectConfig(user.id, "freeze");
  }
  const hydrated = await prisma.inventoryItem.findUnique({
    where: { id: inventoryItemId },
    include: {
      storeItem: {
        include: { effects: { include: { effect: true } } }
      }
    }
  });
  res.json(hydrated);
});
