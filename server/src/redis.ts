import { createClient } from "redis";
import { env } from "./config";

export const redis = createClient({ url: env.REDIS_URL });

redis.on("error", (err) => {
  console.error("Redis error", err);
});

export async function connectRedis() {
  if (!redis.isOpen) {
    await redis.connect();
  }
}
