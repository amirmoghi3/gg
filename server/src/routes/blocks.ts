import { Router } from "express";
import { prisma } from "../config";
import { getAuthedUser } from "../services/userService";
import { notifyBlock, refreshBlockCacheForUser } from "../ws";

export const blocksRouter = Router();

blocksRouter.get("/", async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) {
    res.status(401).send("Unauthorized");
    return;
  }
  const blocks = await prisma.block.findMany({
    where: { blockerId: user.id },
    include: {
      blocked: {
        select: {
          id: true,
          nickname: true,
          avatarUrl: true,
          country: true,
          bio: true
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });
  const blockedBy = await prisma.block.findMany({
    where: { blockedId: user.id },
    select: { blockerId: true }
  });
  res.json({
    blockedIds: blocks.map((b) => b.blockedId),
    blockedByIds: blockedBy.map((b) => b.blockerId),
    blockedUsers: blocks.map((b) => b.blocked)
  });
});

blocksRouter.post("/", async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) {
    res.status(401).send("Unauthorized");
    return;
  }
  const blockedId = String(req.body?.blockedId ?? "");
  if (!blockedId || blockedId === user.id) {
    res.status(400).send("Invalid blockedId");
    return;
  }
  await prisma.block.upsert({
    where: { blockerId_blockedId: { blockerId: user.id, blockedId } },
    create: { blockerId: user.id, blockedId },
    update: {}
  });
  await refreshBlockCacheForUser(user.id);
  await refreshBlockCacheForUser(blockedId);
  notifyBlock(user.id, blockedId);
  res.json({ ok: true });
});

blocksRouter.delete("/:blockedId", async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) {
    res.status(401).send("Unauthorized");
    return;
  }
  const blockedId = String(req.params.blockedId ?? "");
  if (!blockedId) {
    res.status(400).send("Invalid blockedId");
    return;
  }
  await prisma.block.deleteMany({
    where: { blockerId: user.id, blockedId }
  });
  await refreshBlockCacheForUser(user.id);
  await refreshBlockCacheForUser(blockedId);
  res.json({ ok: true });
});
