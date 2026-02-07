import { useEffect, useState } from "react";
import { fetchMutes, unmuteUser } from "../../../lib/api";
import type { MuteState } from "../../../lib/types";

type MutesPanelProps = {
  token: string;
  onView: (id: string) => void;
  refreshKey: number;
  onChanged?: () => void;
};

export function MutesPanel({ token, onView, refreshKey, onChanged }: MutesPanelProps) {
  const [data, setData] = useState<MuteState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void fetchMutes(token).then((result) => {
      setData(result);
      setLoading(false);
    });
  }, [token, refreshKey]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-ink-800/80 p-6 text-white shadow-panel">
        <h2 className="text-xl font-semibold">Muted Users</h2>
        <p className="mt-4 text-sm text-white/60">Loading...</p>
      </div>
    );
  }

  if (!data || data.mutedUsers.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-ink-800/80 p-6 text-white shadow-panel">
        <h2 className="text-xl font-semibold">Muted Users</h2>
        <p className="mt-4 text-sm text-white/60">No muted users.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-ink-800/80 p-6 text-white shadow-panel">
      <h2 className="text-xl font-semibold">Muted Users</h2>
      <div className="mt-4 grid gap-3">
        {data.mutedUsers.map((user) => (
          <div key={user.id} className="flex items-center justify-between rounded-xl bg-white/5 p-3">
            <div className="flex items-center gap-3">
              <img
                className="h-10 w-10 rounded-full object-cover"
                src={user.avatarUrl ?? "assets/avatar.png"}
                alt={user.nickname ?? "User"}
              />
              <div>
                <div className="text-sm font-semibold">{user.nickname ?? "User"}</div>
                <div className="text-xs text-white/60">{user.country ?? ""}</div>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                className="rounded-lg border border-white/15 px-3 py-1 text-xs text-white/70"
                onClick={() => onView(user.id)}
              >
                View
              </button>
              <button
                className="rounded-lg border border-white/15 px-3 py-1 text-xs text-white/70"
                onClick={async () => {
                  await unmuteUser(token, user.id);
                  const next = await fetchMutes(token);
                  setData(next);
                  onChanged?.();
                }}
              >
                Unmute
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
