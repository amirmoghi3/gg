import { useMemo, useState } from "react";
import { updateProfile } from "../../lib/api";
import { getCountries } from "../../lib/countries";
import type { UserProfile } from "../../lib/types";

type OnboardingProps = {
  token: string;
  user: UserProfile;
  onComplete: (user: UserProfile) => void;
};

export function Onboarding({ token, user, onComplete }: OnboardingProps) {
  const [nickname, setNickname] = useState(user.nickname ?? "");
  const [country, setCountry] = useState(user.country ?? "");
  const [status, setStatus] = useState("");
  const countries = useMemo(() => getCountries(), []);

  const handleSave = async () => {
    setStatus("Saving...");
    const updated = await updateProfile(token, {
      nickname: nickname.trim(),
      country
    });
    if (!updated) {
      setStatus("Save failed.");
      return;
    }
    setStatus("Saved.");
    onComplete(updated);
  };

  return (
    <div className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top_left,_#203246,_#0e1116_65%)] text-white">
      <div className="w-[min(480px,92vw)] rounded-2xl border border-white/10 bg-ink-800/80 p-8 shadow-panel">
        <h1 className="text-2xl font-semibold">Finish Setup</h1>
        <p className="mt-2 text-sm text-white/70">
          Add a nickname and country so others can recognize you.
        </p>
        <div className="mt-6 grid gap-3">
          <input
            className="rounded-xl bg-white px-4 py-3 text-sm text-ink-900"
            placeholder="Nickname"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
          />
          <select
            className="rounded-xl bg-white px-4 py-3 text-sm text-ink-900"
            value={country}
            onChange={(event) => setCountry(event.target.value)}
          >
            <option value="">Select country</option>
            {countries.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <button
            className="rounded-xl bg-aura-400 px-4 py-3 text-sm font-semibold text-ink-900"
            onClick={() => void handleSave()}
          >
            Save & Continue
          </button>
          <div className="text-xs text-white/60">{status}</div>
        </div>
      </div>
    </div>
  );
}
