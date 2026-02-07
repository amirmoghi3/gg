import { formatRelative } from "../lib/utils";

type Sender = {
  id: string | null;
  name: string;
  avatarUrl: string | null;
  count: number;
  isOnline: boolean;
  lastSeen: number | null;
};

type SendersModalProps = {
  open: boolean;
  senders: Sender[];
  onClose: () => void;
  onView: (id: string) => void;
};

export function SendersModal({ open, senders, onClose, onView }: SendersModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-[min(420px,92vw)] rounded-2xl border border-white/10 bg-ink-800 p-6 text-white shadow-panel">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Senders</h3>
          <button
            className="rounded-lg border border-white/15 px-3 py-1 text-xs text-white/70"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="mt-4 grid gap-3">
          {senders.map((sender) => (
            <div
              key={`${sender.id ?? "unknown"}-${sender.name}`}
              className="flex items-center justify-between rounded-xl bg-white/5 p-3"
            >
              <div className="flex items-center gap-3">
                <img
                  className="h-10 w-10 rounded-full object-cover"
                  src={sender.avatarUrl ?? "assets/avatar.png"}
                  alt={sender.name}
                />
                <div>
                  <div className="text-sm font-semibold">{sender.name}</div>
                  <div className="text-xs text-white/60">
                    {sender.isOnline
                      ? "Online"
                      : sender.lastSeen
                        ? `Last seen ${formatRelative(sender.lastSeen)}`
                        : "Offline"}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-white/70">x{sender.count}</span>
                <button
                  className="rounded-lg border border-white/15 px-3 py-1 text-xs text-white/80 disabled:opacity-40"
                  disabled={!sender.id}
                  onClick={() => sender.id && onView(sender.id)}
                >
                  View
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
