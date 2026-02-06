import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth";
import { profileRouter } from "./routes/profile";
import { voiceRouter } from "./routes/voice";
import { socialRouter } from "./routes/social";
import { blocksRouter } from "./routes/blocks";
import { mutesRouter } from "./routes/mutes";
import { storeRouter } from "./routes/store";
import { giftsRouter } from "./routes/gifts";
import { inventoryRouter } from "./routes/inventory";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: "*",
      methods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"]
    })
  );
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/auth", authRouter);
  app.use("/profile", profileRouter);
  app.use("/voice", voiceRouter);
  app.use("/social", socialRouter);
  app.use("/blocks", blocksRouter);
  app.use("/mutes", mutesRouter);
  app.use("/store", storeRouter);
  app.use("/gifts", giftsRouter);
  app.use("/inventory", inventoryRouter);

  return app;
}
