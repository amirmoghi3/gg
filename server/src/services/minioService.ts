import { env, minio } from "../config";

export async function ensureBucket() {
  const exists = await minio.bucketExists(env.MINIO_BUCKET);
  if (!exists) {
    await minio.makeBucket(env.MINIO_BUCKET);
  }
  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { AWS: ["*"] },
        Action: ["s3:GetObject"],
        Resource: [`arn:aws:s3:::${env.MINIO_BUCKET}/*`]
      }
    ]
  };
  await minio.setBucketPolicy(env.MINIO_BUCKET, JSON.stringify(policy));
}

export async function createUploadUrl(userId: string, name: string) {
  await ensureBucket();
  const objectName = `${userId}/${Date.now()}-${sanitizeName(name)}`;
  const uploadUrl = await minio.presignedPutObject(env.MINIO_BUCKET, objectName, 600);
  const publicUrl = `${env.MINIO_PUBLIC_URL}/${env.MINIO_BUCKET}/${objectName}`;
  return { uploadUrl, publicUrl };
}

function sanitizeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}
