import { Router } from "express";
import { prisma } from "../config";
import { getAuthedUser } from "../services/userService";

export const storeRouter = Router();

storeRouter.get("/items", async (_req, res) => {
  const items = await prisma.storeItem.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "desc" }
  });
  res.json(items);
});

storeRouter.post("/buy", async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) {
    res.status(401).send("Unauthorized");
    return;
  }
  const itemId = String(req.body?.itemId ?? "");
  const quantity = Math.max(1, Number(req.body?.quantity ?? 1));
  if (!itemId) {
    res.status(400).send("Missing itemId");
    return;
  }
  const item = await prisma.storeItem.findUnique({ where: { id: itemId } });
  if (!item || !item.isActive) {
    res.status(404).send("Item not found");
    return;
  }
  const total = item.price * quantity;

  const balance = await prisma.currencyBalance.findUnique({
    where: { userId_currency: { userId: user.id, currency: "GG" } }
  });
  if (!balance || balance.balance < total) {
    res.status(400).send("Not enough GG");
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.currencyBalance.update({
      where: { userId_currency: { userId: user.id, currency: "GG" } },
      data: { balance: { decrement: total } }
    });

    const createdItems = await Promise.all(
      Array.from({ length: quantity }).map(() =>
        tx.inventoryItem.create({
          data: { userId: user.id, storeItemId: item.id }
        })
      )
    );
    await Promise.all(
      createdItems.map((created) =>
        tx.inventoryItem.update({
          where: { id: created.id },
          data: { rootInventoryId: created.id }
        })
      )
    );

    await tx.transaction.create({
      data: {
        fromUserId: user.id,
        toUserId: null,
        currency: "GG",
        amount: total,
        type: "buy"
      }
    });
  });

  res.json({ ok: true });
});
