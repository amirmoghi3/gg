import { prisma } from "../config";
import { ActionType } from "@prisma/client";

type CooldownResult = {
  allowed: boolean;
  retryAfter: number;
  cooldownSeconds: number;
};

const cooldownCache = new Map<ActionType, { seconds: number; ts: number }>();
const CACHE_TTL_MS = 30_000;

async function getCooldownSeconds(type: ActionType) {
  const cached = cooldownCache.get(type);
  const now = Date.now();
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return cached.seconds;
  }
  const row = await prisma.cooldown.findUnique({ where: { type } });
  const seconds = row?.seconds ?? 0;
  cooldownCache.set(type, { seconds, ts: now });
  return seconds;
}

export async function checkCooldown(userId: string, type: ActionType): Promise<CooldownResult> {
  const seconds = await getCooldownSeconds(type);
  if (seconds <= 0) {
    return { allowed: true, retryAfter: 0, cooldownSeconds: seconds };
  }
  const last = await prisma.actionLog.findFirst({
    where: { userId, type },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true }
  });
  if (!last) {
    return { allowed: true, retryAfter: 0, cooldownSeconds: seconds };
  }
  const elapsed = (Date.now() - last.createdAt.getTime()) / 1000;
  const remaining = Math.max(0, Math.ceil(seconds - elapsed));
  return {
    allowed: remaining <= 0,
    retryAfter: remaining,
    cooldownSeconds: seconds
  };
}

export async function ensureCooldownDefaults() {
  const defaults: Array<{ type: ActionType; seconds: number }> = [
    { type: ActionType.GIFT_SEND, seconds: 180 },
    { type: ActionType.GIFT_RECEIVE, seconds: 10 },
    { type: ActionType.GIFT_ACCEPT, seconds: 5 },
    { type: ActionType.GIFT_REJECT, seconds: 5 }
  ];
  await Promise.all(
    defaults.map((entry) =>
      prisma.cooldown.upsert({
        where: { type: entry.type },
        create: entry,
        update: {}
      })
    )
  );
}
