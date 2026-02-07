import "dotenv/config";
import http from "node:http";
import { createApp } from "./app";
import { attachWebsocket, notifyInventoryExpired, notifyToast } from "./ws";
import { ensureBucket } from "./services/minioService";
import { connectRedis } from "./redis";
import { ensureCooldownDefaults } from "./services/cooldownService";
import { prisma } from "./config";

const app = createApp();
const server = http.createServer(app);

attachWebsocket(server);

const port = Number(process.env.PORT ?? 8080);
server.listen(port, async () => {
  await connectRedis();
  await ensureBucket();
  await ensureCooldownDefaults();
  setInterval(async () => {
    try {
      const now = new Date();
      const expired = await prisma.inventoryItem.findMany({
        where: {
          expiresAt: { not: null, lte: now },
          isEquipped: true
        },
        select: { id: true, userId: true }
      });
      if (expired.length === 0) return;
      await prisma.inventoryItem.updateMany({
        where: { id: { in: expired.map((item) => item.id) } },
        data: { isEquipped: false }
      });
      for (const item of expired) {
        notifyInventoryExpired(item.userId, item.id);
        notifyToast(item.userId, "An equipped item expired.");
      }
    } catch (err) {
      console.error("inventory cleanup failed", err);
    }
  }, 30000);
  console.log(`Server listening on http://localhost:${port}`);
});
