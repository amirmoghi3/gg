import { Router } from "express";
import { prisma } from "../config";
import { getAuthedUser } from "../services/userService";
import { getLastSeen, isOnline } from "../services/stateService";

export const inventoryRouter = Router();

inventoryRouter.get("/", async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) {
    res.status(401).send("Unauthorized");
    return;
  }
  const items = await prisma.inventoryItem.findMany({
    where: { userId: user.id },
    include: { storeItem: true },
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

      return {
        ...item,
        senders: withPresence
      };
    })
  );

  res.json(response);
});
