import { AccessToken } from "livekit-server-sdk";
import { env } from "../config";

export function createVoiceToken(identity: string, room = "main") {
  if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
    throw new Error("LIVEKIT_API_KEY/SECRET not set");
  }
  const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity
  });
  token.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canSubscribe: true
  });
  return token.toJwt();
}
