import { useEffect, useMemo, useState } from "react";
import {
  blockUser,
  fetchInventory,
  fetchPublicProfile,
  muteUser,
  sendGift,
  unblockUser,
  unmuteUser
} from "../lib/api";
import type { InventoryItem, PublicProfile } from "../lib/types";
import { formatCooldown, resolveStoreImageUrl } from "../lib/utils";

type ProfileModalProps = {
  open: boolean;
  profileId: string | null;
  token: string;
  selfId: string;
  onClose: () => void;
  onBlocked: (id: string) => void;
  onMuted: (id: string) => void;
  confirm: (message: string) => Promise<boolean>;
};

type Tab = "profile" | "action";

export function ProfileModal({
  open,
  profileId,
  token,
  selfId,
  onClose,
  onBlocked,
  onMuted,
  confirm
}: ProfileModalProps) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [tab, setTab] = useState<Tab>("profile");
  const [loading, setLoading] = useState(false);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [tick, setTick] = useState(Date.now());

  useEffect(() => {
    if (!open || !profileId) return;
    setLoading(true);
    void fetchPublicProfile(token, profileId).then((data) => {
      setProfile(data);
      setLoading(false);
      setTab("profile");
    });
  }, [open, profileId, token]);

  useEffect(() => {
    if (!open || tab !== "action") return;
    setInventoryLoading(true);
    void fetchInventory(token).then((items) => {
      setInventory(items ?? []);
      setInventoryLoading(false);
    });
  }, [open, tab, token]);

  useEffect(() => {
    if (!open) return;
    window.dispatchEvent(new Event("gg:profile-opened"));
    return () => {
      window.dispatchEvent(new Event("gg:profile-closed"));
    };
  }, [open]);

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const timer = window.setInterval(() => setTick(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  const currentImageIndex = useMemo(() => {
    if (!profile?.images || profile.images.length === 0) return 0;
    const primaryIndex = profile.images.findIndex((img) => img.isPrimary);
    return primaryIndex >= 0 ? primaryIndex : 0;
  }, [profile?.images]);

  const [sliderIndex, setSliderIndex] = useState(0);
  useEffect(() => {
    setSliderIndex(currentImageIndex);
  }, [currentImageIndex]);

  if (!open || !profileId) return null;

  const isBusy = loading || !profile;

  const images = profile?.images ?? [];
  const activeImage = images[sliderIndex]?.url ?? profile?.avatarUrl ?? "assets/avatar.png";
  const ageDays = profile
    ? Math.max(0, Math.floor((Date.now() - new Date(profile.createdAt).getTime()) / 86400000))
    : 0;
  const hours = profile ? (profile.gameplaySeconds / 3600).toFixed(1) : "0";
  const cooldownRemaining = Math.max(0, cooldownUntil - tick);

  const toggleBlock = async () => {
    if (!profile) return;
    if (profile.isBlocked) {
      await unblockUser(token, profile.id);
      setProfile({ ...profile, isBlocked: false });
      onBlocked(profile.id);
      return;
    }
    const ok = await confirm(`Block ${profile.nickname ?? "user"}?`);
    if (!ok) return;
    await blockUser(token, profile.id);
    setProfile({ ...profile, isBlocked: true });
    onBlocked(profile.id);
  };

  const toggleMute = async () => {
    if (!profile) return;
    if (profile.isMuted) {
      await unmuteUser(token, profile.id);
      setProfile({ ...profile, isMuted: false });
      onMuted(profile.id);
      return;
    }
    const ok = await confirm(`Mute ${profile.nickname ?? "user"}?`);
    if (!ok) return;
    await muteUser(token, profile.id);
    setProfile({ ...profile, isMuted: true });
    onMuted(profile.id);
  };

  const sendGiftToUser = async (item: InventoryItem) => {
    if (cooldownRemaining > 0 || !profile) return;
    const ok = await confirm(`Send ${item.storeItem.name} to this user?`);
    if (!ok) return;
    const result = await sendGift(token, profile.id, item.id);
    if (result.ok) {
      const seconds = result.cooldownSeconds ?? 0;
      setCooldownUntil(seconds > 0 ? Date.now() + seconds * 1000 : 0);
      const items = await fetchInventory(token);
      setInventory(items ?? []);
    } else if (typeof result.retryAfter === "number") {
      setCooldownUntil(Date.now() + result.retryAfter * 1000);
    }
  };

  return (
    <div
      id="public-profile-modal"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-[min(440px,92vw)] rounded-2xl border border-white/10 bg-ink-800 p-6 text-white shadow-panel">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">{profile?.nickname ?? "Player"}</h3>
            <p className="text-xs text-white/50">{profile?.country ?? ""}</p>
          </div>
          <button
            className="rounded-lg border border-white/15 px-3 py-1 text-xs text-white/70"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {isBusy ? (
          <div className="mt-6 text-sm text-white/70">Loading...</div>
        ) : (
          <div className="mt-4 grid gap-4">
            <div className="flex items-center gap-3">
              <button
                className="rounded-full border border-white/10 p-2 text-xs text-white/70"
                onClick={() =>
                  setSliderIndex((prev) =>
                    images.length ? (prev - 1 + images.length) % images.length : 0
                  )
                }
              >
                {"<"}
              </button>
              <img
                className="h-24 w-24 rounded-full object-cover"
                src={activeImage}
                alt={profile?.nickname ?? "Profile"}
              />
              <button
                className="rounded-full border border-white/10 p-2 text-xs text-white/70"
                onClick={() =>
                  setSliderIndex((prev) => (images.length ? (prev + 1) % images.length : 0))
                }
              >
                {">"}
              </button>
            </div>

            <div className="flex gap-2 text-xs">
              <button
                className={`rounded-lg px-3 py-1 ${tab === "profile" ? "bg-aura-400 text-ink-900" : "bg-white/10 text-white/70"}`}
                onClick={() => setTab("profile")}
              >
                Profile
              </button>
              {profile?.id !== selfId && (
                <button
                  className={`rounded-lg px-3 py-1 ${tab === "action" ? "bg-aura-400 text-ink-900" : "bg-white/10 text-white/70"}`}
                  onClick={() => setTab("action")}
                >
                  Actions
                </button>
              )}
            </div>

            {tab === "profile" && (
              <div className="grid gap-3 text-sm text-white/80">
                {profile?.id !== selfId && (
                  <div className="flex gap-2">
                    <button
                      className={`rounded-lg px-3 py-1 text-xs ${profile?.isBlocked ? "bg-red-500/30 text-red-200" : "bg-red-500/10 text-red-200"}`}
                      onClick={toggleBlock}
                    >
                      {profile?.isBlocked ? "Unblock" : "Block"}
                    </button>
                    <button
                      className={`rounded-lg px-3 py-1 text-xs ${profile?.isMuted ? "bg-amber-500/30 text-amber-200" : "bg-amber-500/10 text-amber-200"}`}
                      onClick={toggleMute}
                    >
                      {profile?.isMuted ? "Unmute" : "Mute"}
                    </button>
                  </div>
                )}
                <p className="text-sm text-white/70">{profile?.bio ?? "No bio."}</p>
                <div className="grid grid-cols-[auto_1fr] gap-2 text-xs text-white/70">
                  <span>Instagram</span>
                  <span>{profile?.instagram ?? "-"}</span>
                  <span>LinkedIn</span>
                  <span>{profile?.linkedin ?? "-"}</span>
                  <span>Account Age</span>
                  <span>{ageDays} days</span>
                  <span>Gameplay</span>
                  <span>{hours} hours</span>
                </div>
              </div>
            )}

            {tab === "action" && (
              <div className="grid gap-3">
                {inventoryLoading ? (
                  <div className="text-sm text-white/60">Loading gifts...</div>
                ) : inventory.length === 0 ? (
                  <div className="text-sm text-white/60">No gifts available. Buy from the store.</div>
                ) : (
                  <div className="grid gap-2">
                    {inventory.map((item) => {
                      const imageUrl = resolveStoreImageUrl(item.storeItem.imageUrl);
                      return (
                        <div
                          key={item.id}
                          className="flex items-center justify-between rounded-xl bg-white/5 p-3"
                        >
                          <div className="flex items-center gap-3">
                            {imageUrl && (
                              <img
                                className="h-10 w-10 rounded-lg object-cover"
                                src={imageUrl}
                                alt={item.storeItem.name}
                              />
                            )}
                            <div>
                              <div className="text-sm font-semibold">{item.storeItem.name}</div>
                              <div className="text-xs text-white/60">{item.storeItem.category}</div>
                            </div>
                          </div>
                          <button
                            className="rounded-lg bg-aura-400 px-3 py-1 text-xs font-semibold text-ink-900 disabled:opacity-50"
                            disabled={cooldownRemaining > 0}
                            onClick={() => void sendGiftToUser(item)}
                          >
                            {cooldownRemaining > 0
                              ? `Send (${formatCooldown(cooldownRemaining)})`
                              : "Send"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
