import { Router } from "express";
import { prisma } from "../config";
import { getAuthedUser, serializeUser } from "../services/userService";
import { createUploadUrl } from "../services/minioService";
import { notifyAvatarChange } from "../ws";

export const profileRouter = Router();

profileRouter.get("/me", async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) {
    res.status(401).send("Unauthorized");
    return;
  }
  const balances = await prisma.currencyBalance.findMany({
    where: { userId: user.id }
  });
  res.json({ ...serializeUser(user), balances });
});

profileRouter.post("/update", async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) {
    res.status(401).send("Unauthorized");
    return;
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      nickname: req.body?.nickname ?? null,
      bio: req.body?.bio ?? null,
      avatarUrl: req.body?.avatarUrl ?? null,
      instagram: req.body?.instagram ?? null,
      linkedin: req.body?.linkedin ?? null,
      country: req.body?.country ?? null
    }
  });
  const balances = await prisma.currencyBalance.findMany({
    where: { userId: user.id }
  });
  res.json({ ...serializeUser(updated), balances });
});

profileRouter.get("/public/:id", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) {
    res.status(404).send("Not found");
    return;
  }
  const images = await prisma.userImage.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" }
  });
  res.json({
    id: user.id,
    nickname: user.nickname,
    bio: user.bio,
    avatarUrl: user.avatarUrl,
    instagram: user.instagram,
    linkedin: user.linkedin,
    country: user.country,
    createdAt: user.createdAt.toISOString(),
    gameplaySeconds: user.gameplaySeconds,
    images
  });
});

profileRouter.post("/upload-url", async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) {
    res.status(401).send("Unauthorized");
    return;
  }
  const name = String(req.body?.name ?? "upload.png");
  const { uploadUrl, publicUrl } = await createUploadUrl(user.id, name);
  res.json({ uploadUrl, publicUrl });
});

profileRouter.get("/images", async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) {
    res.status(401).send("Unauthorized");
    return;
  }
  const images = await prisma.userImage.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" }
  });
  res.json(images);
});

profileRouter.post("/images", async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) {
    res.status(401).send("Unauthorized");
    return;
  }
  const url = String(req.body?.url ?? "");
  if (!url) {
    res.status(400).send("Missing url");
    return;
  }
  const existingPrimary = await prisma.userImage.findFirst({
    where: { userId: user.id, isPrimary: true },
    select: { id: true }
  });
  if (!existingPrimary) {
    const [, image] = await prisma.$transaction([
      prisma.userImage.updateMany({
        where: { userId: user.id },
        data: { isPrimary: false }
      }),
      prisma.userImage.create({
        data: {
          userId: user.id,
          url,
          isPrimary: true
        }
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { avatarUrl: url }
      })
    ]);
    notifyAvatarChange(user.id, url);
    res.json(image);
    return;
  }
  const image = await prisma.userImage.create({
    data: {
      userId: user.id,
      url,
      isPrimary: false
    }
  });
  res.json(image);
});

profileRouter.post("/images/primary", async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) {
    res.status(401).send("Unauthorized");
    return;
  }
  const imageId = String(req.body?.imageId ?? "");
  if (!imageId) {
    res.status(400).send("Missing imageId");
    return;
  }
  const image = await prisma.userImage.findUnique({ where: { id: imageId } });
  if (!image || image.userId !== user.id) {
    res.status(404).send("Not found");
    return;
  }
  await prisma.$transaction([
    prisma.userImage.updateMany({
      where: { userId: user.id },
      data: { isPrimary: false }
    }),
    prisma.userImage.update({
      where: { id: imageId },
      data: { isPrimary: true }
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl: image.url }
    })
  ]);
  notifyAvatarChange(user.id, image.url);
  res.json({ ok: true, avatarUrl: image.url });
});

profileRouter.delete("/images/:id", async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) {
    res.status(401).send("Unauthorized");
    return;
  }
  const image = await prisma.userImage.findUnique({ where: { id: req.params.id } });
  if (!image || image.userId !== user.id) {
    res.status(404).send("Not found");
    return;
  }
  const wasPrimary = image.isPrimary;
  await prisma.userImage.delete({ where: { id: image.id } });
  if (wasPrimary) {
    const nextPrimary = await prisma.userImage.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" }
    });
    if (nextPrimary) {
      await prisma.$transaction([
        prisma.userImage.update({
          where: { id: nextPrimary.id },
          data: { isPrimary: true }
        }),
        prisma.user.update({
          where: { id: user.id },
          data: { avatarUrl: nextPrimary.url }
        })
      ]);
      notifyAvatarChange(user.id, nextPrimary.url);
    } else {
      await prisma.user.update({
        where: { id: user.id },
        data: { avatarUrl: null }
      });
      notifyAvatarChange(user.id, null);
    }
  }
  res.json({ ok: true });
});
