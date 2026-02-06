import kavenegar from "kavenegar";
import { Client as MinioClient } from "minio";
import { PrismaClient } from "@prisma/client";

export const env = {
  LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY ?? "",
  LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET ?? "",
  SMS_API_KEY: process.env.SMS_API_KEY ?? "",
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  MINIO_ENDPOINT: process.env.MINIO_ENDPOINT ?? "localhost:9000",
  MINIO_ACCESS_KEY: process.env.MINIO_ACCESS_KEY ?? "minioadmin",
  MINIO_SECRET_KEY: process.env.MINIO_SECRET_KEY ?? "minioadmin123",
  MINIO_BUCKET: process.env.MINIO_BUCKET ?? "gg",
  MINIO_PUBLIC_URL: process.env.MINIO_PUBLIC_URL ?? "http://localhost:9000",
  NODE_ENV: process.env.NODE_ENV ?? "development"
};

export const prisma = new PrismaClient();

export const kavenegarApi = env.SMS_API_KEY
  ? kavenegar.KavenegarApi({ apikey: env.SMS_API_KEY })
  : null;

const [minioHost, minioPort] = env.MINIO_ENDPOINT.split(":");
export const minio = new MinioClient({
  endPoint: minioHost,
  port: Number(minioPort ?? 9000),
  useSSL: false,
  accessKey: env.MINIO_ACCESS_KEY,
  secretKey: env.MINIO_SECRET_KEY
});
