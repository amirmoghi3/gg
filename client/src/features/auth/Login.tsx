import { useState } from "react";
import { requestOtp, verifyOtp } from "../../lib/api";
import type { AuthResponse } from "../../lib/types";

const copy = {
  title: "Welcome Back",
  subtitle: "Log in with your phone to continue."
};

type LoginProps = {
  onLogin: (auth: AuthResponse) => void;
};

export function Login({ onLogin }: LoginProps) {
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [status, setStatus] = useState("");

  const handleRequest = async () => {
    setStatus("Sending code...");
    const ok = await requestOtp(phone.trim());
    setStatus(ok ? "OTP sent." : "Failed to send OTP.");
  };

  const handleVerify = async () => {
    setStatus("Verifying...");
    const result = await verifyOtp(phone.trim(), otp.trim());
    if (!result) {
      setStatus("Invalid OTP.");
      return;
    }
    onLogin(result);
  };

  return (
    <div className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top,_#1b2b3a,_#0e1116_55%)] text-white">
      <div className="w-[min(420px,90vw)] rounded-2xl border border-white/10 bg-ink-800/80 p-8 shadow-panel">
        <h1 className="text-2xl font-semibold">{copy.title}</h1>
        <p className="mt-2 text-sm text-white/70">{copy.subtitle}</p>
        <div className="mt-6 grid gap-3">
          <input
            className="rounded-xl bg-white px-4 py-3 text-sm text-ink-900"
            type="tel"
            placeholder="Phone number"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
          <button
            className="rounded-xl bg-aura-400 px-4 py-3 text-sm font-semibold text-ink-900"
            onClick={() => void handleRequest()}
          >
            Send Code
          </button>
          <input
            className="rounded-xl bg-white px-4 py-3 text-sm text-ink-900"
            type="text"
            placeholder="OTP code"
            value={otp}
            onChange={(event) => setOtp(event.target.value)}
          />
          <button
            className="rounded-xl bg-aura-400 px-4 py-3 text-sm font-semibold text-ink-900"
            onClick={() => void handleVerify()}
          >
            Verify & Login
          </button>
          <div className="text-xs text-white/60">{status}</div>
        </div>
      </div>
    </div>
  );
}
