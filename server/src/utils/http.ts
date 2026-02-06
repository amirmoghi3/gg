import { Request } from "express";

export function getBearerToken(req: Request) {
  const auth = req.headers.authorization ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}
