import type { UserProfile } from "../../../lib/types";

type StartPanelProps = {
  user: UserProfile;
  inGame: boolean;
  onEnterWorld: () => void;
  onExitWorld: () => void;
  onReturnToWorld: () => void;
};

export function StartPanel({ user, inGame, onEnterWorld, onExitWorld, onReturnToWorld }: StartPanelProps) {
  const ageDays = Math.max(
    0,
    Math.floor((Date.now() - new Date(user.createdAt).getTime()) / 86400000)
  );
  const hours = (user.gameplaySeconds / 3600).toFixed(1);

  return (
    <div className="rounded-2xl border border-white/10 bg-ink-800/80 p-6 text-white shadow-panel">
      <h2 className="text-xl font-semibold">Play</h2>
      <p className="mt-2 text-sm text-white/70">Join the world and meet people nearby.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        {inGame ? (
          <button
            className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-semibold text-ink-900"
            onClick={onExitWorld}
          >
            Disconnect From World
          </button>
        ) : (
          <button
            className="rounded-xl bg-aura-400 px-4 py-2 text-sm font-semibold text-ink-900"
            onClick={onEnterWorld}
          >
            Enter World
          </button>
        )}
        {inGame && (
          <button
            className="rounded-xl border border-white/20 px-4 py-2 text-sm text-white/80"
            onClick={onReturnToWorld}
          >
            Return to World
          </button>
        )}
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-white/5 p-3">
          <div className="text-xs text-white/60">Account Age</div>
          <div className="text-base font-semibold">{ageDays} days</div>
        </div>
        <div className="rounded-xl bg-white/5 p-3">
          <div className="text-xs text-white/60">Gameplay</div>
          <div className="text-base font-semibold">{hours} hours</div>
        </div>
      </div>
    </div>
  );
}
