import { useEffect, useState } from "react";
import { buyStoreItem, fetchStoreItems } from "../../../lib/api";
import type { StoreItem } from "../../../lib/types";
import { resolveStoreImageUrl } from "../../../lib/utils";

type StorePanelProps = {
  token: string;
  onBought: () => void;
  confirm: (message: string) => Promise<boolean>;
};

export function StorePanel({ token, onBought, confirm }: StorePanelProps) {
  const [items, setItems] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void fetchStoreItems().then((data) => {
      setItems(data ?? []);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-ink-800/80 p-6 text-white shadow-panel">
        <h2 className="text-xl font-semibold">Store</h2>
        <p className="mt-4 text-sm text-white/60">Loading...</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-ink-800/80 p-6 text-white shadow-panel">
        <h2 className="text-xl font-semibold">Store</h2>
        <p className="mt-4 text-sm text-white/60">No items available.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-ink-800/80 p-6 text-white shadow-panel">
      <h2 className="text-xl font-semibold">Store</h2>
      <div className="mt-4 grid gap-3">
        {items.map((item) => {
          const imageUrl = resolveStoreImageUrl(item.imageUrl);
          return (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-white/5 p-4">
              <div className="flex items-center gap-4">
                {imageUrl && (
                  <img className="h-14 w-14 rounded-lg object-cover" src={imageUrl} alt={item.name} />
                )}
                <div>
                  <div className="text-sm font-semibold">{item.name}</div>
                  <div className="text-xs text-white/60">{item.category}</div>
                  <div className="text-xs text-white/50">{item.description ?? ""}</div>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="text-sm text-white/70">GG {item.price}</span>
                <button
                  className="rounded-lg bg-aura-400 px-3 py-1 text-xs font-semibold text-ink-900"
                  onClick={async () => {
                    const ok = await confirm(`Buy ${item.name} for GG ${item.price}?`);
                    if (!ok) return;
                    const success = await buyStoreItem(token, item.id, 1);
                    if (success) onBought();
                  }}
                >
                  Buy
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
