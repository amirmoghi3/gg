import { Router } from "express";
import { prisma } from "../config";
import { getAuthedUser } from "../services/userService";

export const socialRouter = Router();

socialRouter.get("/inbox", async (req, res) => {
  const user = await getAuthedUser(req);
  if (!user) {
    res.status(401).send("Unauthorized");
    return;
  }

  const events = await prisma.socialEvent.findMany({
    where: { toUserId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50
  });
  res.json(events);
});
