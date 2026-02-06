import { kavenegarApi, env, prisma } from "../config";
import { createSessionForUser, storeOtp, verifyOtpCode } from "./stateService";

export function normalizePhone(phone: unknown) {
  if (typeof phone !== "string") return "";
  return phone.replace(/[^\d+]/g, "");
}

export function generateOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export async function sendOtp(phone: string, code: string) {
  if (env.NODE_ENV === "development") return;
  if (!kavenegarApi) {
    throw new Error("SMS_API_KEY not set");
  }
  await new Promise<void>((resolve, reject) => {
    kavenegarApi.VerifyLookup(
      {
        receptor: phone,
        token: code,
        template: "login-nextskill"
      },
      (_response: unknown, status: unknown) => {
        if (status && Number(status) >= 200 && Number(status) < 300) {
          resolve();
        } else {
          reject(new Error(`Kavenegar error: ${String(status)}`));
        }
      }
    );
  });
}

export async function storeOtpCode(phone: string, code: string) {
  await storeOtp(phone, code);
}

export async function verifyOtp(phone: string, code: string) {
  const isDevBypass = env.NODE_ENV === "development" && code === "8585";
  if (isDevBypass) return true;
  return verifyOtpCode(phone, code);
}

export async function loginOrCreate(phone: string) {
  const user = await prisma.user.upsert({
    where: { phone },
    create: { phone, lastLoginAt: new Date() },
    update: { lastLoginAt: new Date() }
  });
  await prisma.currencyBalance.upsert({
    where: { userId_currency: { userId: user.id, currency: "GG" } },
    create: { userId: user.id, currency: "GG", balance: 100 },
    update: {}
  });
  const token = await createSessionForUser(user.id);
  return { token, user };
}
