import { useEffect, useState } from "react";
import { fetchInventory } from "../../../lib/api";
import type { InventoryItem } from "../../../lib/types";
import { resolveStoreImageUrl } from "../../../lib/utils";
import { SendersModal } from "../../../components/SendersModal";

type InventoryPanelProps = {
  token: string;
  onView: (id: string) => void;
  refreshKey: number;
};

export function InventoryPanel({ token, onView, refreshKey }: InventoryPanelProps) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [openSenders, setOpenSenders] = useState<InventoryItem["senders"] | null>(
    null
  );

  useEffect(() => {
    setLoading(true);
    void fetchInventory(token).then((data) => {
      setItems(data ?? []);
      setLoading(false);
    });
  }, [token, refreshKey]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-ink-800/80 p-6 text-white shadow-panel">
        <h2 className="text-xl font-semibold">Inventory</h2>
        <p className="mt-4 text-sm text-white/60">Loading...</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-ink-800/80 p-6 text-white shadow-panel">
        <h2 className="text-xl font-semibold">Inventory</h2>
        <p className="mt-4 text-sm text-white/60">No items yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-ink-800/80 p-6 text-white shadow-panel">
      <h2 className="text-xl font-semibold">Inventory</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const imageUrl = resolveStoreImageUrl(item.storeItem.imageUrl);
          const senders = item.senders ?? [];
          return (
            <div key={item.id} className="rounded-xl bg-white/5 p-3">
              {imageUrl && (
                <img
                  className="mb-2 h-12 w-12 rounded-lg object-cover"
                  src={imageUrl}
                  alt={item.storeItem.name}
                />
              )}
              <div className="text-sm font-semibold">{item.storeItem.name}</div>
              <div className="text-xs text-white/60">{item.storeItem.category}</div>
              {senders.length > 0 && (
                <div className="mt-2 grid gap-2">
                  {senders.slice(0, 2).map((sender) => (
                    <button
                      key={`${sender.id ?? "unknown"}-${sender.name}`}
                      className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs text-white/70"
                      onClick={() => sender.id && onView(sender.id)}
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${sender.isOnline ? "bg-emerald-400" : "bg-white/30"}`}
                      />
                      {sender.name}
                    </button>
                  ))}
                  {senders.length > 2 && (
                    <button
                      className="text-left text-xs text-aura-400"
                      onClick={() => setOpenSenders(senders)}
                    >
                      Show more ({senders.length - 2})
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <SendersModal
        open={Boolean(openSenders)}
        senders={openSenders ?? []}
        onClose={() => setOpenSenders(null)}
        onView={(id) => {
          onView(id);
          setOpenSenders(null);
        }}
      />
    </div>
  );
}
