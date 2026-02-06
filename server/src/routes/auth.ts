import { Router } from "express";
import {
  generateOtp,
  loginOrCreate,
  normalizePhone,
  sendOtp,
  storeOtpCode,
  verifyOtp
} from "../services/authService";
import { serializeUser } from "../services/userService";

export const authRouter = Router();

authRouter.post("/request-otp", async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (!phone) {
    res.status(400).send("Missing phone");
    return;
  }
  const code = generateOtp();
  await storeOtpCode(phone, code);
  try {
    await sendOtp(phone, code);
  } catch (err) {
    res.status(500).send(String(err));
    return;
  }
  res.status(200).send("OK");
});

authRouter.post("/verify-otp", async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const code = String(req.body?.code ?? "");
  if (!phone || !code) {
    res.status(400).send("Missing phone or code");
    return;
  }
  const valid = await verifyOtp(phone, code);
  if (!valid) {
    res.status(401).send("Invalid code");
    return;
  }
  const { token, user } = await loginOrCreate(phone);
  res.json({ token, user: serializeUser(user) });
});
