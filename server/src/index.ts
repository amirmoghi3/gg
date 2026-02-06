import "dotenv/config";
import http from "node:http";
import { createApp } from "./app";
import { attachWebsocket } from "./ws";
import { ensureBucket } from "./services/minioService";
import { connectRedis } from "./redis";
import { ensureCooldownDefaults } from "./services/cooldownService";

const app = createApp();
const server = http.createServer(app);

attachWebsocket(server);

const port = Number(process.env.PORT ?? 8080);
server.listen(port, async () => {
  await connectRedis();
  await ensureBucket();
  await ensureCooldownDefaults();
  console.log(`Server listening on http://localhost:${port}`);
});
