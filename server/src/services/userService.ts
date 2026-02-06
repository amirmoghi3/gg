import { prisma } from "../config";
import { Request } from "express";
import { getSessionUserId } from "./stateService";

export async function getAuthedUser(req: Request) {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const userId = await getSessionUserId(token);
  if (!userId) return null;
  return prisma.user.findUnique({ where: { id: userId } });
}

export function serializeUser(user: {
  id: string;
  phone: string;
  nickname: string | null;
  bio: string | null;
  avatarUrl: string | null;
  instagram: string | null;
  linkedin: string | null;
  country: string | null;
  createdAt: Date;
  gameplaySeconds: number;
}) {
  return {
    id: user.id,
    phone: user.phone,
    nickname: user.nickname,
    bio: user.bio,
    avatarUrl: user.avatarUrl,
    instagram: user.instagram,
    linkedin: user.linkedin,
    country: user.country,
    createdAt: user.createdAt.toISOString(),
    gameplaySeconds: user.gameplaySeconds
  };
}
