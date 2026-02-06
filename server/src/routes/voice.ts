import { Router } from "express";
import { createVoiceToken } from "../services/voiceService";

export const voiceRouter = Router();

voiceRouter.get("/token", async (req, res) => {
  const identity = String(req.query.identity ?? "");
  const room = String(req.query.room ?? "main");
  if (!identity) {
    res.status(400).send("Missing identity");
    return;
  }

  try {
    const token = await createVoiceToken(identity, room);
    res.json({ token });
  } catch (err) {
    res.status(500).send(String(err));
  }
});
