import { Router } from "express";
import { prisma } from "../config";
import { getAuthedUser } from "../services/userService";

export const mutesRouter = Router();

mutesRouter.get("/", async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) {
    res.status(401).send("Unauthorized");
    return;
  }
  const mutes = await prisma.mute.findMany({
    where: { muterId: user.id },
    include: {
      muted: {
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
  res.json({
    mutedIds: mutes.map((m) => m.mutedId),
    mutedUsers: mutes.map((m) => m.muted)
  });
});

mutesRouter.post("/", async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) {
    res.status(401).send("Unauthorized");
    return;
  }
  const mutedId = String(req.body?.mutedId ?? "");
  if (!mutedId || mutedId === user.id) {
    res.status(400).send("Invalid mutedId");
    return;
  }
  await prisma.mute.upsert({
    where: { muterId_mutedId: { muterId: user.id, mutedId } },
    create: { muterId: user.id, mutedId },
    update: {}
  });
  res.json({ ok: true });
});

mutesRouter.delete("/:mutedId", async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) {
    res.status(401).send("Unauthorized");
    return;
  }
  const mutedId = String(req.params.mutedId ?? "");
  if (!mutedId) {
    res.status(400).send("Invalid mutedId");
    return;
  }
  await prisma.mute.deleteMany({
    where: { muterId: user.id, mutedId }
  });
  res.json({ ok: true });
});
