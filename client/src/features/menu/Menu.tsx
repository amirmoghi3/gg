import type { ReactNode } from "react";
import type { UserProfile } from "../../lib/types";

type MenuProps = {
  user: UserProfile;
  ggBalance: number;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onLogout: () => void;
  inGame: boolean;
  menuVisible: boolean;
  children: ReactNode;
};

const tabs = [
  { id: "start", label: "Play" },
  { id: "profile", label: "Profile" },
  { id: "blocks", label: "Blocks" },
  { id: "mutes", label: "Mutes" },
  { id: "inventory", label: "Inventory" },
  { id: "store", label: "Store" }
];

export function Menu({
  user,
  ggBalance,
  activeTab,
  onTabChange,
  onLogout,
  inGame,
  menuVisible,
  children
}: MenuProps) {
  return (
    <div
      className={`fixed inset-0 z-20 min-h-screen overflow-auto bg-[radial-gradient(circle_at_top_left,_#203246,_#0e1116_65%)] text-white ${
        inGame && !menuVisible ? "hidden" : "block"
      }`}
      data-role="menu"
    >
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-6 py-5">
        <div className="text-lg font-semibold">GG Social</div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-white/80">{user.nickname ?? user.phone ?? "Player"}</span>
          <span className="rounded-full bg-aura-400/20 px-3 py-1 text-xs font-semibold text-aura-400">
            GG {ggBalance}
          </span>
          <button
            className="rounded-lg border border-white/20 px-3 py-1 text-xs text-white/80"
            onClick={onLogout}
          >
            Logout
          </button>
        </div>
      </header>
      <div className="grid gap-6 px-6 py-6 lg:grid-cols-[200px_1fr]">
        <nav className="flex flex-wrap gap-2 lg:flex-col">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`rounded-xl px-4 py-2 text-left text-sm ${
                activeTab === tab.id
                  ? "bg-aura-400 text-ink-900 font-semibold"
                  : "bg-white/10 text-white/80"
              }`}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <section>{children}</section>
      </div>
    </div>
  );
}
