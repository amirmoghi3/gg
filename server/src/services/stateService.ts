import crypto from "node:crypto";
import { redis } from "../redis";

const OTP_TTL_SECONDS = 5 * 60;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const ACTIVE_SOCKET_TTL_SECONDS = 90;
const SESSION_START_TTL_SECONDS = 24 * 60 * 60;
const LAST_SEEN_TTL_SECONDS = 14 * 24 * 60 * 60;

export async function tryConsumeCooldown(
  userId: string,
  action: string,
  ttlSeconds: number
) {
  const key = `cooldown:${action}:${userId}`;
  const ok = await redis.set(key, "1", { NX: true, EX: ttlSeconds });
  if (ok) {
    return { allowed: true, retryAfter: 0 };
  }
  const ttl = await redis.ttl(key);
  return { allowed: false, retryAfter: ttl > 0 ? ttl : ttlSeconds };
}

export async function clearCooldown(userId: string, action: string) {
  await redis.del(`cooldown:${action}:${userId}`);
}

export async function storeOtp(phone: string, code: string) {
  await redis.set(`otp:${phone}`, code, { EX: OTP_TTL_SECONDS });
}

export async function verifyOtpCode(phone: string, code: string) {
  const stored = await redis.get(`otp:${phone}`);
  if (!stored) return false;
  if (stored !== code) return false;
  await redis.del(`otp:${phone}`);
  return true;
}

export async function createSessionForUser(userId: string) {
  const token = crypto.randomUUID();
  const previousToken = await redis.get(`userSession:${userId}`);
  if (previousToken) {
    await redis.del(`session:${previousToken}`);
  }
  await redis.set(`session:${token}`, userId, { EX: SESSION_TTL_SECONDS });
  await redis.set(`userSession:${userId}`, token, { EX: SESSION_TTL_SECONDS });
  return token;
}

export async function getSessionUserId(token: string) {
  if (!token) return null;
  return redis.get(`session:${token}`);
}

export async function getLatestSessionToken(userId: string) {
  return redis.get(`userSession:${userId}`);
}

export async function setSessionStart(userId: string) {
  await redis.set(`sessionStart:${userId}`, String(Date.now()), {
    EX: SESSION_START_TTL_SECONDS
  });
}

export async function consumeSessionStart(userId: string) {
  const value = await redis.get(`sessionStart:${userId}`);
  await redis.del(`sessionStart:${userId}`);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function setActiveSocket(userId: string, socketId: string) {
  await redis.set(`activeSocket:${userId}`, socketId, {
    EX: ACTIVE_SOCKET_TTL_SECONDS
  });
}

export async function clearActiveSocket(userId: string) {
  await redis.del(`activeSocket:${userId}`);
}

export async function setLastSeen(userId: string) {
  await redis.set(`lastSeen:${userId}`, String(Date.now()), {
    EX: LAST_SEEN_TTL_SECONDS
  });
}

export async function getLastSeen(userId: string) {
  const value = await redis.get(`lastSeen:${userId}`);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function isOnline(userId: string) {
  const value = await redis.get(`activeSocket:${userId}`);
  return !!value;
}
