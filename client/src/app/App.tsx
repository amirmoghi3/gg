import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { startGame } from "../game";
import { ConfirmModal } from "../components/ConfirmModal";
import { ProfileModal } from "../components/ProfileModal";
import { Login } from "../features/auth/Login";
import { Onboarding } from "../features/auth/Onboarding";
import { Menu } from "../features/menu/Menu";
import { BlocksPanel } from "../features/menu/panels/BlocksPanel";
import { InventoryPanel } from "../features/menu/panels/InventoryPanel";
import { MutesPanel } from "../features/menu/panels/MutesPanel";
import { ProfilePanel } from "../features/menu/panels/ProfilePanel";
import { StartPanel } from "../features/menu/panels/StartPanel";
import { StorePanel } from "../features/menu/panels/StorePanel";
import { fetchBlocks, fetchMe, fetchMutes } from "../lib/api";
import type { UserProfile } from "../lib/types";
import { parseUser } from "../lib/utils";

const STORAGE_TOKEN = "gg:token";
const STORAGE_USER = "gg:user";

type ConfirmState = { open: boolean; message: string };

type Tab = "start" | "profile" | "blocks" | "mutes" | "inventory" | "store";

export function App() {
  const [token, setToken] = useState(localStorage.getItem(STORAGE_TOKEN) ?? "");
  const [user, setUser] = useState<UserProfile | null>(
    parseUser<UserProfile>(localStorage.getItem(STORAGE_USER))
  );
  const [loading, setLoading] = useState(true);
  const [inGame, setInGame] = useState(false);
  const [menuVisible, setMenuVisible] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("start");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    open: false,
    message: ""
  });
  const confirmResolver = useRef<(ok: boolean) => void>();
  const [refreshKey, setRefreshKey] = useState(0);
  const gameRef = useRef<ReturnType<typeof startGame> | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    void (async () => {
      const me = await fetchMe(token);
      if (!me) {
        setToken("");
        setUser(null);
        localStorage.removeItem(STORAGE_TOKEN);
        localStorage.removeItem(STORAGE_USER);
        setLoading(false);
        return;
      }
      setUser(me);
      localStorage.setItem(STORAGE_USER, JSON.stringify(me));
      setLoading(false);
    })();
  }, [token]);

  useEffect(() => {
    if (!inGame) {
      setMenuVisible(true);
    }
  }, [inGame]);

  const ggBalance = useMemo(() => {
    return user?.balances?.find((b) => b.currency === "GG")?.balance ?? 0;
  }, [user]);

  const confirm = useCallback((message: string) => {
    setConfirmState({ open: true, message });
    return new Promise<boolean>((resolve) => {
      confirmResolver.current = resolve;
    });
  }, []);

  const closeConfirm = (ok: boolean) => {
    confirmResolver.current?.(ok);
    confirmResolver.current = undefined;
    setConfirmState({ open: false, message: "" });
  };

  const refreshUser = useCallback(async () => {
    if (!token) return;
    const me = await fetchMe(token);
    if (!me) return;
    setUser(me);
    localStorage.setItem(STORAGE_USER, JSON.stringify(me));
  }, [token]);

  const refreshBlocks = useCallback(async () => {
    if (!token) return;
    const data = await fetchBlocks(token);
    if (!data) return;
    gameRef.current?.setBlocks?.(data.blockedIds, data.blockedByIds);
  }, [token]);

  const refreshMutes = useCallback(async () => {
    if (!token) return;
    const data = await fetchMutes(token);
    if (!data) return;
    gameRef.current?.setMutes?.(data.mutedIds);
  }, [token]);

  const handleLogin = async (auth: { token: string; user: UserProfile }) => {
    setToken(auth.token);
    setUser(auth.user);
    localStorage.setItem(STORAGE_TOKEN, auth.token);
    localStorage.setItem(STORAGE_USER, JSON.stringify(auth.user));
    setActiveTab("start");
    setLoading(false);
  };

  const handleLogout = () => {
    gameRef.current?.destroy();
    gameRef.current = null;
    setInGame(false);
    setMenuVisible(true);
    setToken("");
    setUser(null);
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_USER);
  };

  const enterWorld = async () => {
    if (!user || !token) return;
    if (gameRef.current) return;
    setInGame(true);
    setMenuVisible(false);
    const [blocks, mutes] = await Promise.all([fetchBlocks(token), fetchMutes(token)]);
    gameRef.current = startGame({
      parentId: "game-root",
      token,
      user,
      onOpenProfile: (id) => setProfileId(id),
      blockedIds: blocks?.blockedIds ?? [],
      blockedByIds: blocks?.blockedByIds ?? [],
      mutedIds: mutes?.mutedIds ?? [],
      ggBalance
    });
  };

  const exitWorld = () => {
    gameRef.current?.destroy();
    gameRef.current = null;
    setInGame(false);
    setMenuVisible(true);
  };

  const openProfile = (id: string) => {
    setProfileId(id);
  };

  if (loading) {
    return <div className="min-h-screen bg-ink-900" />;
  }

  if (!token || !user) {
    return <Login onLogin={handleLogin} />;
  }

  if (!user.nickname || !user.country) {
    return (
      <Onboarding
        token={token}
        user={user}
        onComplete={(updated) => {
          setUser(updated);
          localStorage.setItem(STORAGE_USER, JSON.stringify(updated));
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-ink-900 text-white">
      <div
        id="game-overlay"
        className={inGame ? "game-active" : ""}
      >
        <div id="game-root" />
      </div>

      <Menu
        user={user}
        ggBalance={ggBalance}
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab as Tab)}
        onLogout={handleLogout}
        inGame={inGame}
        menuVisible={menuVisible}
      >
        {activeTab === "start" && (
          <StartPanel
            user={user}
            inGame={inGame}
            onEnterWorld={() => void enterWorld()}
            onExitWorld={exitWorld}
            onReturnToWorld={() => setMenuVisible(false)}
          />
        )}
        {activeTab === "profile" && (
          <ProfilePanel
            token={token}
            user={user}
            onUserUpdate={(updated) => {
              setUser(updated);
              localStorage.setItem(STORAGE_USER, JSON.stringify(updated));
            }}
          />
        )}
        {activeTab === "blocks" && (
          <BlocksPanel
            token={token}
            onView={openProfile}
            refreshKey={refreshKey}
            onChanged={() => void refreshBlocks()}
          />
        )}
        {activeTab === "mutes" && (
          <MutesPanel
            token={token}
            onView={openProfile}
            refreshKey={refreshKey}
            onChanged={() => void refreshMutes()}
          />
        )}
        {activeTab === "inventory" && (
          <InventoryPanel
            token={token}
            onView={openProfile}
            refreshKey={refreshKey}
          />
        )}
        {activeTab === "store" && (
          <StorePanel
            token={token}
            confirm={confirm}
            onBought={async () => {
              await refreshUser();
              setRefreshKey((prev) => prev + 1);
            }}
          />
        )}
      </Menu>

      {inGame && !menuVisible && (
        <button
          className="fixed left-4 top-4 z-30 rounded-xl border border-white/20 bg-ink-800/80 px-4 py-2 text-xs text-white"
          onClick={() => setMenuVisible(true)}
        >
          Menu
        </button>
      )}

      <ProfileModal
        open={Boolean(profileId)}
        profileId={profileId}
        token={token}
        selfId={user.id}
        onClose={() => setProfileId(null)}
        onBlocked={async (id) => {
          await refreshBlocks();
          setRefreshKey((prev) => prev + 1);
          gameRef.current?.blockUser?.(id);
        }}
        onMuted={async (id) => {
          await refreshMutes();
          setRefreshKey((prev) => prev + 1);
          gameRef.current?.muteUser?.(id);
        }}
        confirm={confirm}
      />

      <ConfirmModal
        open={confirmState.open}
        message={confirmState.message}
        onConfirm={() => closeConfirm(true)}
        onCancel={() => closeConfirm(false)}
      />
    </div>
  );
}
