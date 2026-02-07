import { Router } from "express";
import { prisma } from "../config";
import { getAuthedUser } from "../services/userService";
import { notifyToast, notifyGiftOffer, notifyGiftReturn, notifyFreezeNearby } from "../ws";
import { checkCooldown } from "../services/cooldownService";
import { ActionType } from "@prisma/client";

export const giftsRouter = Router();

giftsRouter.post("/send", async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) {
    res.status(401).send("Unauthorized");
    return;
  }
  const toUserId = String(req.body?.toUserId ?? "");
  const inventoryItemId = String(req.body?.inventoryItemId ?? "");
  const message = req.body?.message ? String(req.body?.message) : null;
  if (!toUserId || !inventoryItemId || toUserId === user.id) {
    res.status(400).send("Invalid payload");
    return;
  }
  const inventory = await prisma.inventoryItem.findUnique({
    where: { id: inventoryItemId }
  });
  if (!inventory || inventory.userId !== user.id) {
    res.status(400).send("Not in inventory");
    return;
  }
  const item = await prisma.storeItem.findUnique({ where: { id: inventory.storeItemId } });
  if (!item || !item.isActive) {
    res.status(404).send("Item not found");
    return;
  }

  const senderCooldown = await checkCooldown(user.id, ActionType.GIFT_SEND);
  if (!senderCooldown.allowed) {
    res.status(429).json({
      error: "sender_cooldown",
      retryAfter: senderCooldown.retryAfter
    });
    return;
  }

  const receiverCooldown = await checkCooldown(
    toUserId,
    ActionType.GIFT_RECEIVE
  );
  if (!receiverCooldown.allowed) {
    res.status(429).json({
      error: "receiver_cooldown",
      retryAfter: receiverCooldown.retryAfter
    });
    return;
  }

  const gift = await prisma.$transaction(async (tx) => {
    const senderInventory = await tx.inventoryItem.delete({
      where: { id: inventory.id }
    });

    const created = await tx.gift.create({
      data: {
        fromUserId: user.id,
        toUserId,
        storeItemId: item.id,
        message,
        fromInventoryItemId:
          senderInventory.rootInventoryId ?? senderInventory.id,
        status: "pending",
        expiresAt: new Date(Date.now() + 7000)
      }
    });

    await tx.actionLog.create({
      data: {
        userId: user.id,
        type: ActionType.GIFT_SEND,
        data: {
          giftId: created.id,
          toUserId,
          storeItemId: item.id
        }
      }
    });

    return created;
  });

  notifyGiftOffer(toUserId, {
    id: gift.id,
    fromUserId: user.id,
    fromName: user.nickname ?? user.phone ?? "Someone",
    fromAvatarUrl: user.avatarUrl ?? null,
    itemId: item.id,
    itemName: item.name,
    itemImageUrl: item.imageUrl ?? null,
    expiresAt: gift.expiresAt.toISOString()
  });
  notifyToast(user.id, `Gift sent: ${item.name}`);
  res.json({
    ok: true,
    itemName: item.name,
    cooldownSeconds: senderCooldown.cooldownSeconds
  });
});

giftsRouter.post("/decide", async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) {
    res.status(401).send("Unauthorized");
    return;
  }
  const giftId = String(req.body?.giftId ?? "");
  const action = String(req.body?.action ?? "");
  if (!giftId || !["accept", "reject"].includes(action)) {
    res.status(400).send("Invalid payload");
    return;
  }

  const gift = await prisma.gift.findUnique({
    where: { id: giftId },
    include: {
      storeItem: {
        include: { effects: { include: { effect: true } } }
      }
    }
  });
  if (!gift || gift.toUserId !== user.id) {
    res.status(404).send("Gift not found");
    return;
  }
  if (gift.status !== "pending") {
    res.json({ ok: true, status: gift.status });
    return;
  }

  const now = new Date();
  if (gift.expiresAt.getTime() < now.getTime()) {
    await prisma.$transaction(async (tx) => {
      await tx.gift.update({
        where: { id: gift.id },
        data: { status: "expired", decidedAt: now }
      });
      await tx.actionLog.create({
        data: {
          userId: user.id,
          type: ActionType.GIFT_EXPIRE,
          data: { giftId: gift.id }
        }
      });
      if (gift.fromUserId) {
        await tx.inventoryItem.create({
          data: {
            userId: gift.fromUserId,
            storeItemId: gift.storeItemId,
            rootInventoryId: gift.fromInventoryItemId ?? undefined,
            sourceGiftId: gift.id
          }
        });
      } else {
        await tx.actionLog.create({
          data: {
            type: ActionType.GIFT_EXPIRE,
            data: { giftId: gift.id, reason: "no_sender" }
          }
        });
      }
    });
    if (gift.fromUserId) {
      notifyToast(gift.fromUserId, "Your gift expired");
      notifyGiftReturn(gift.fromUserId, {
        giftId: gift.id,
        storeItemId: gift.storeItemId,
        reason: "expired"
      });
    }
    res.json({ ok: true, status: "expired" });
    return;
  }

  if (action === "reject") {
    const cooldown = await checkCooldown(user.id, ActionType.GIFT_REJECT);
    if (!cooldown.allowed) {
      res.status(429).json({
        error: "receiver_cooldown",
        retryAfter: cooldown.retryAfter
      });
      return;
    }
    await prisma.$transaction(async (tx) => {
      await tx.gift.update({
        where: { id: gift.id },
        data: { status: "rejected", decidedAt: now }
      });
      await tx.actionLog.create({
        data: {
          userId: user.id,
          type: ActionType.GIFT_REJECT,
          data: { giftId: gift.id }
        }
      });
      if (gift.fromUserId) {
        await tx.inventoryItem.create({
          data: {
            userId: gift.fromUserId,
            storeItemId: gift.storeItemId,
            rootInventoryId: gift.fromInventoryItemId ?? undefined,
            sourceGiftId: gift.id
          }
        });
      } else {
        await tx.actionLog.create({
          data: {
            type: ActionType.GIFT_REJECT,
            data: { giftId: gift.id, reason: "no_sender" }
          }
        });
      }
    });
    if (gift.fromUserId) {
      notifyToast(gift.fromUserId, `${user.nickname ?? "User"} rejected your gift`);
      notifyGiftReturn(gift.fromUserId, {
        giftId: gift.id,
        storeItemId: gift.storeItemId,
        reason: "rejected"
      });
    }
    notifyToast(user.id, "Gift rejected");
    res.json({ ok: true, status: "rejected" });
    return;
  }

  const acceptCooldown = await checkCooldown(user.id, ActionType.GIFT_ACCEPT);
  if (!acceptCooldown.allowed) {
    res.status(429).json({
      error: "receiver_cooldown",
      retryAfter: acceptCooldown.retryAfter
    });
    return;
  }

  await prisma.$transaction(async (tx) => {
    const rootInventoryId = gift.fromInventoryItemId ?? null;
    const recipientInventory = await tx.inventoryItem.create({
      data: {
        userId: user.id,
        storeItemId: gift.storeItemId,
        rootInventoryId: rootInventoryId ?? undefined,
        sourceGiftId: gift.id
      }
    });

    await tx.gift.update({
      where: { id: gift.id },
      data: {
        status: "accepted",
        decidedAt: now,
        toInventoryItemId: recipientInventory.id
      }
    });

    await tx.actionLog.create({
      data: {
        userId: user.id,
        type: ActionType.GIFT_ACCEPT,
        data: { giftId: gift.id }
      }
    });

    await tx.actionLog.create({
      data: {
        userId: user.id,
        type: ActionType.GIFT_RECEIVE,
        data: {
          giftId: gift.id,
          fromUserId: gift.fromUserId,
          storeItemId: gift.storeItemId
        }
      }
    });

    await tx.socialEvent.create({
      data: {
        toUserId: user.id,
        fromUserId: gift.fromUserId,
        type: "gift",
        message: `${gift.storeItem.name}`
      }
    });
  });

  if (gift.fromUserId) {
    notifyToast(
      gift.fromUserId,
      `${user.nickname ?? "User"} accepted your gift`
    );
  }
  notifyToast(user.id, `You received ${gift.storeItem.name}`);
  for (const link of gift.storeItem.effects ?? []) {
    const effect = link.effect;
    if (effect.handlerKey === "freeze_nearby") {
      const radius =
        typeof (effect.config as any)?.radius === "number"
          ? (effect.config as any).radius
          : 120;
      const durationMs =
        typeof (effect.config as any)?.durationMs === "number"
          ? (effect.config as any).durationMs
          : (effect.durationSeconds ?? 3) * 1000;
      notifyFreezeNearby(user.id, radius, durationMs);
    }
  }
  res.json({ ok: true, status: "accepted" });
});
