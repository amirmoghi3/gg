import { startGame } from "../game";

type UserProfile = {
  id: string;
  phone: string;
  nickname: string | null;
  bio: string | null;
  avatarUrl: string | null;
  instagram: string | null;
  linkedin: string | null;
  country: string | null;
  createdAt: string;
  gameplaySeconds: number;
  balances?: Array<{ currency: string; balance: number }>;
};

type StoreItem = {
  id: string;
  name: string;
  category: string;
  price: number;
  description?: string | null;
  imageUrl?: string | null;
  isEquippable?: boolean;
  effects?: Array<{
    effect: {
      slug: string;
      handlerKey: string;
      durationSeconds?: number | null;
      config?: any;
    };
  }>;
};

type InventoryItem = {
  id: string;
  isEquipped: boolean;
  expiresAt?: string | null;
  isExpired?: boolean;
  storeItem: StoreItem;
  senders?: Array<{
    id: string | null;
    name: string;
    avatarUrl: string | null;
    count: number;
    isOnline: boolean;
    lastSeen: number | null;
  }>;
};

type AuthResponse = {
  token: string;
  user: UserProfile;
};

const STORAGE_TOKEN = "gg:token";
const STORAGE_USER = "gg:user";

const API_BASE = `http://${window.location.hostname || "localhost"}:8080`;
const STORE_IMAGE_BASE =
  ((import.meta as any).env?.VITE_STORE_IMAGE_BASE as string | undefined) ?? "";
let giftSendCooldownUntil = 0;
let giftSendCooldownTimer: number | null = null;
let giftReturnListenerAttached = false;
let actionTabContext: { token: string; toUserId: string } | null = null;
let inventoryExpireListenerAttached = false;

function resolveStoreImageUrl(url?: string | null) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  const base = STORE_IMAGE_BASE.replace(/\/$/, "");
  const path = url.startsWith("/") ? url : `/${url}`;
  return base ? `${base}${path}` : url;
}

function showToast(text: string) {
  let container = document.getElementById("toast-center");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-center";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = text;
  container.appendChild(toast);
  window.setTimeout(() => {
    toast.classList.add("hide");
    window.setTimeout(() => toast.remove(), 300);
  }, 2200);
}

export function mountApp(root: HTMLElement) {
  if (!giftReturnListenerAttached) {
    giftReturnListenerAttached = true;
    window.addEventListener("gg:gift-returned", () => {
      if (!actionTabContext) return;
      const modal = document.getElementById("profile-modal");
      const actionSection = modal?.querySelector(
        ".profile-modal-section.action"
      ) as HTMLElement | null;
      if (!actionSection) return;
      if (actionSection.style.display === "none") return;
      void renderActionTab(
        actionSection,
        actionTabContext.token,
        actionTabContext.toUserId
      );
    });
  }
  if (!inventoryExpireListenerAttached) {
    inventoryExpireListenerAttached = true;
    window.addEventListener("gg:inventory-expired", () => {
      const menu = document.querySelector("[data-role='menu']") as HTMLElement | null;
      if (!menu || menu.classList.contains("menu-hidden")) return;
      const panel = menu.querySelector(".menu-panel") as HTMLElement | null;
      if (!panel) return;
      const inventoryTab = document.querySelector(
        "button[data-tab='inventory']"
      ) as HTMLButtonElement | null;
      if (!inventoryTab || !inventoryTab.classList.contains("active")) return;
      const token = localStorage.getItem(STORAGE_TOKEN) ?? "";
      if (!token) return;
      const user = parseUser(localStorage.getItem(STORAGE_USER));
      if (!user) return;
      void renderInventoryPanel(panel, {
        token,
        user,
        inGame: false,
        gameController: null,
        menuVisible: true
      });
    });
  }
  const state = {
    token: localStorage.getItem(STORAGE_TOKEN) ?? "",
    user: parseUser(localStorage.getItem(STORAGE_USER)),
    inGame: false,
    gameController: null as null | {
      destroy: () => void;
      setBlocks?: (blockedIds: string[], blockedByIds: string[]) => void;
      blockUser?: (id: string) => void;
    },
    menuVisible: true
  };

  const render = async () => {
    if (!state.token) {
      renderLogin(root, state);
      return;
    }
    const me = await fetchMe(state.token);
    if (!me) {
      state.token = "";
      state.user = null;
      localStorage.removeItem(STORAGE_TOKEN);
      localStorage.removeItem(STORAGE_USER);
      renderLogin(root, state);
      return;
    }
    state.user = me;
    localStorage.setItem(STORAGE_USER, JSON.stringify(me));
    renderMenu(root, state);
  };

  void render();
}

async function applyEquippedEffects(token: string) {
  const items = await fetchInventory(token);
  if (!items) return;
  for (const item of items) {
    if (!item.isEquipped) continue;
    const effects = item.storeItem.effects ?? [];
    for (const link of effects) {
      if (link.effect.handlerKey === "freeze_nearby") {
        const radius =
          typeof link.effect.config?.radius === "number" ? link.effect.config.radius : 120;
        const durationMs =
          typeof link.effect.config?.durationMs === "number"
            ? link.effect.config.durationMs
            : (link.effect.durationSeconds ?? 3) * 1000;
        const includeSelf = !!link.effect.config?.includeSelf;
        window.dispatchEvent(
          new CustomEvent("gg:effect-equipped", {
            detail: {
              key: "freeze",
              radius,
              durationMs,
              includeSelf,
              expiresAt: item.expiresAt ?? null
            }
          })
        );
      }
    }
  }
}

function renderLogin(
  root: HTMLElement,
  state: { token: string; user: UserProfile | null }
) {
  root.innerHTML = "";
  const container = document.createElement("div");
  container.className = "login";

  const card = document.createElement("div");
  card.className = "login-card";

  const title = document.createElement("h1");
  title.textContent = "Welcome Back";

  const subtitle = document.createElement("p");
  subtitle.textContent = "Log in with your phone to continue.";

  const phoneInput = document.createElement("input");
  phoneInput.type = "tel";
  phoneInput.placeholder = "Phone number";

  const otpInput = document.createElement("input");
  otpInput.type = "text";
  otpInput.placeholder = "OTP code";

  const requestBtn = document.createElement("button");
  requestBtn.textContent = "Send Code";

  const loginBtn = document.createElement("button");
  loginBtn.textContent = "Verify & Login";

  const status = document.createElement("div");
  status.className = "login-status";

  requestBtn.addEventListener("click", async () => {
    status.textContent = "Sending code...";
    const ok = await requestOtp(phoneInput.value.trim());
    status.textContent = ok ? "OTP sent." : "Failed to send OTP.";
  });

  loginBtn.addEventListener("click", async () => {
    status.textContent = "Verifying...";
    const result = await verifyOtp(phoneInput.value.trim(), otpInput.value.trim());
    if (!result) {
      status.textContent = "Invalid OTP.";
      return;
    }
    state.token = result.token;
    state.user = result.user;
    localStorage.setItem(STORAGE_TOKEN, result.token);
    localStorage.setItem(STORAGE_USER, JSON.stringify(result.user));
    if (!state.user.nickname || !state.user.country) {
      renderOnboarding(root, state);
      return;
    }
    renderMenu(root, state);
  });

  card.appendChild(title);
  card.appendChild(subtitle);
  card.appendChild(phoneInput);
  card.appendChild(requestBtn);
  card.appendChild(otpInput);
  card.appendChild(loginBtn);
  card.appendChild(status);

  container.appendChild(card);
  root.appendChild(container);
}

function renderMenu(
  root: HTMLElement,
  state: {
    token: string;
    user: UserProfile | null;
    inGame: boolean;
    gameController: null | {
      destroy: () => void;
      setBlocks?: (blockedIds: string[], blockedByIds: string[]) => void;
      blockUser?: (id: string) => void;
    };
    menuVisible: boolean;
  }
) {
  if (!state.user) return;

  root.innerHTML = "";
  const container = document.createElement("div");
  container.className = "menu";
  container.dataset.role = "menu";

  const header = document.createElement("header");
  header.className = "menu-header";
  const ggBalance =
    state.user.balances?.find((b) => b.currency === "GG")?.balance ?? 0;
  const displayName = state.user.nickname ?? state.user.phone ?? "Player";
  header.innerHTML = `
    <div class="brand">
      GG Social
      ${state.inGame ? `<button class="ghost" data-action="return">Return</button>` : ""}
    </div>
    <div class="actions">
      <span class="menu-name">${displayName}</span>
      <span class="menu-balance">GG ${ggBalance}</span>
      <button class="ghost" data-action="logout">Logout</button>
    </div>
  `;

  const content = document.createElement("div");
  content.className = "menu-content";

  const nav = document.createElement("nav");
  nav.className = "menu-nav";
  nav.innerHTML = `
    <button data-tab="start" class="active">Play</button>
    <button data-tab="profile">Profile</button>
    <button data-tab="blocks">Blocks</button>
    <button data-tab="mutes">Mutes</button>
    <button data-tab="inventory">Inventory</button>
    <button data-tab="store">Store</button>
  `;

  const panel = document.createElement("div");
  panel.className = "menu-panel";

  content.appendChild(nav);
  content.appendChild(panel);
  container.appendChild(header);
  container.appendChild(content);
  root.appendChild(container);

  const renderTab = async (tab: string) => {
    if (tab === "start") {
      renderStartPanel(panel, state);
      return;
    }
    if (tab === "profile") {
      renderProfilePanel(panel, state);
      return;
    }
    if (tab === "blocks") {
      void renderBlocksPanel(panel, state);
      return;
    }
    if (tab === "mutes") {
      void renderMutesPanel(panel, state);
      return;
    }
    if (tab === "inventory") {
      void renderInventoryPanel(panel, state);
      return;
    }
    renderStorePanel(panel, state);
  };

  const updateMenuBalance = () => {
    const ggBalance =
      state.user?.balances?.find((b) => b.currency === "GG")?.balance ?? 0;
    const balanceEl = container.querySelector(".menu-balance");
    if (balanceEl) {
      balanceEl.textContent = `GG ${ggBalance}`;
    }
  };

  nav.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (!target.matches("button[data-tab]")) return;
    const tab = target.getAttribute("data-tab") ?? "start";
    nav.querySelectorAll("button").forEach((btn) => btn.classList.remove("active"));
    target.classList.add("active");
    void renderTab(tab);
  });

  header.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.matches("button[data-action='return']")) {
      const menu = document.querySelector("[data-role='menu']") as HTMLElement | null;
      if (menu) {
        menu.classList.add("menu-hidden");
      }
      state.menuVisible = false;
      const menuButton = document.getElementById("menu-toggle") as HTMLButtonElement | null;
      if (menuButton) {
        menuButton.style.display = "block";
      }
      return;
    }
    if (!target.matches("button[data-action='logout']")) return;
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_USER);
    state.token = "";
    state.user = null;
    renderLogin(root, state);
  });

  void renderTab("start");
  updateMenuBalance();

  const menuButton = ensureMenuToggle();
  menuButton.style.display = state.inGame && !state.menuVisible ? "block" : "none";
  menuButton.onclick = () => {
    state.menuVisible = !state.menuVisible;
    container.classList.toggle("menu-hidden", !state.menuVisible);
    menuButton.style.display = state.inGame && !state.menuVisible ? "block" : "none";
  };

  if (!state.inGame) {
    state.menuVisible = true;
    container.classList.remove("menu-hidden");
  } else {
    container.classList.toggle("menu-hidden", !state.menuVisible);
  }
  menuButton.style.display = state.inGame && !state.menuVisible ? "block" : "none";
}

function renderStartPanel(
  panel: HTMLElement,
  state: {
    token: string;
    user: UserProfile;
    inGame: boolean;
    gameController: null | {
      destroy: () => void;
      setBlocks?: (blockedIds: string[], blockedByIds: string[]) => void;
      blockUser?: (id: string) => void;
    };
    menuVisible: boolean;
  }
) {
  panel.innerHTML = "";
  const card = document.createElement("div");
  card.className = "panel-card";

  const title = document.createElement("h2");
  title.textContent = "Play";

  const desc = document.createElement("p");
  desc.textContent = "Join the world and meet people nearby.";

  const button = document.createElement("button");
  button.textContent = state.inGame ? "Disconnect From World" : "Enter World";
  const returnBtn = document.createElement("button");
  returnBtn.textContent = "Return to World";

  const stats = document.createElement("div");
  stats.className = "stats";
  const ageDays = Math.max(
    0,
    Math.floor((Date.now() - new Date(state.user.createdAt).getTime()) / 86400000)
  );
  const hours = (state.user.gameplaySeconds / 3600).toFixed(1);
  stats.innerHTML = `
    <div><strong>Account Age</strong><span>${ageDays} days</span></div>
    <div><strong>Gameplay</strong><span>${hours} hours</span></div>
  `;

  button.addEventListener("click", async () => {
    if (state.inGame && state.gameController) {
      state.gameController.destroy();
      state.inGame = false;
      state.gameController = null;
      const menuButton = document.getElementById("menu-toggle") as HTMLButtonElement | null;
      if (menuButton) {
        menuButton.style.display = "none";
      }
      const menu = document.querySelector("[data-role='menu']") as HTMLElement | null;
      if (menu) {
        menu.classList.remove("menu-hidden");
      }
      renderStartPanel(panel, state);
      return;
    }

    const overlay = ensureGameOverlay();
    overlay.classList.add("game-active");
    let blockState: Awaited<ReturnType<typeof fetchBlocks>> = null;
    let muteState: Awaited<ReturnType<typeof fetchMutes>> = null;
    try {
      blockState = await fetchBlocks(state.token);
      muteState = await fetchMutes(state.token);
    } catch {
      blockState = null;
      muteState = null;
    }
    const ggBalance =
      state.user?.balances?.find((b) => b.currency === "GG")?.balance ?? 0;
    state.gameController = startGame({
      parentId: "game-root",
      token: state.token,
      user: state.user,
      onOpenProfile: (id) => {
        void openPublicProfile(
          state.token,
          id,
          state.user!.id,
          async (blockedId) => {
            await refreshBlockState(state, blockedId);
          },
          async (mutedId) => {
            await refreshMuteState(state, mutedId);
          }
        );
      },
      blockedIds: blockState?.blockedIds ?? [],
      blockedByIds: blockState?.blockedByIds ?? [],
      mutedIds: muteState?.mutedIds ?? [],
      ggBalance
    });
    const onGameReady = () => {
      window.removeEventListener("gg:game-ready", onGameReady);
      void applyEquippedEffects(state.token);
    };
    window.addEventListener("gg:game-ready", onGameReady);
    state.inGame = true;
    state.menuVisible = false;
    const menuButton = document.getElementById("menu-toggle") as HTMLButtonElement | null;
    if (menuButton) {
      menuButton.style.display = "block";
    }
    const menu = document.querySelector("[data-role='menu']") as HTMLElement | null;
    if (menu) {
      menu.classList.add("menu-hidden");
    }
    renderStartPanel(panel, state);
  });

  returnBtn.addEventListener("click", () => {
    const menu = document.querySelector("[data-role='menu']") as HTMLElement | null;
    if (menu) {
      menu.classList.add("menu-hidden");
    }
    state.menuVisible = false;
    const menuButton = document.getElementById("menu-toggle") as HTMLButtonElement | null;
    if (menuButton) {
      menuButton.style.display = "block";
    }
  });

  card.appendChild(title);
  card.appendChild(desc);
  card.appendChild(button);
  if (state.inGame) {
    card.appendChild(returnBtn);
  }
  card.appendChild(stats);
  panel.appendChild(card);
}

function renderProfilePanel(
  panel: HTMLElement,
  state: {
    token: string;
    user: UserProfile;
    inGame: boolean;
    gameController: null | {
      destroy: () => void;
      setBlocks?: (a: string[], b: string[]) => void;
      blockUser?: (id: string) => void;
      setMutes?: (ids: string[]) => void;
      muteUser?: (id: string) => void;
    };
    menuVisible: boolean;
  }
) {
  panel.innerHTML = "";
  const card = document.createElement("div");
  card.className = "panel-card";

  const title = document.createElement("h2");
  title.textContent = "Profile";

  const nickname = document.createElement("input");
  nickname.value = state.user.nickname ?? "";
  nickname.placeholder = "Nickname";

  const bio = document.createElement("textarea");
  bio.value = state.user.bio ?? "";
  bio.placeholder = "Bio";

  const instagram = document.createElement("input");
  instagram.value = state.user.instagram ?? "";
  instagram.placeholder = "Instagram link";

  const linkedin = document.createElement("input");
  linkedin.value = state.user.linkedin ?? "";
  linkedin.placeholder = "LinkedIn link";

  const country = document.createElement("select");
  country.className = "profile-select";
  buildCountryOptions(country, state.user.country);

  const upload = document.createElement("input");
  upload.type = "file";
  upload.accept = "image/*";
  upload.multiple = true;
  upload.className = "profile-upload-hidden";

  const save = document.createElement("button");
  save.textContent = "Save Profile";

  const status = document.createElement("div");
  status.className = "profile-status";

  const refreshImages = async () => {
    const images = await fetchProfileImages(state.token);
    if (!images) return;
    renderImageGallery(imageGallery, images, state.token, state);
  };
  upload.addEventListener("change", async () => {
    if (!upload.files || upload.files.length === 0) return;
    status.textContent = "Uploading...";
    const files = Array.from(upload.files);
    for (const file of files) {
      if (file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif")) {
        status.textContent = "GIF is not supported.";
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        status.textContent = "Each image must be under 10MB.";
        return;
      }
      const compressed = await compressImage(file);
      if (!compressed) {
        status.textContent = "Image compression failed.";
        return;
      }
      const uploadResult = await requestUploadUrl(
        state.token,
        compressed.name,
        compressed.type
      );
      if (!uploadResult) {
        status.textContent = "Upload failed.";
        return;
      }
      const ok = await uploadFile(uploadResult.uploadUrl, compressed);
      if (!ok) {
        status.textContent = "Upload failed.";
        return;
      }
      await saveProfileImage(state.token, uploadResult.publicUrl);
    }
    await refreshImages();
    status.textContent = "Upload complete.";
    upload.value = "";
  });

  save.addEventListener("click", async () => {
    status.textContent = "Saving...";
    const updated = await updateProfile(state.token, {
      nickname: nickname.value.trim(),
      bio: bio.value.trim(),
      avatarUrl: state.user.avatarUrl,
      instagram: instagram.value.trim(),
      linkedin: linkedin.value.trim(),
      country: country.value
    });
    if (!updated) {
      status.textContent = "Save failed.";
      return;
    }
    state.user = updated;
    localStorage.setItem(STORAGE_USER, JSON.stringify(updated));
    status.textContent = "Saved.";
  });

  card.appendChild(title);
  const mediaRow = document.createElement("div");
  mediaRow.className = "profile-media-row";
  mediaRow.appendChild(upload);

  const imageGallery = document.createElement("div");
  imageGallery.className = "profile-gallery";
  mediaRow.appendChild(imageGallery);

  const uploadButton = document.createElement("button");
  uploadButton.type = "button";
  uploadButton.className = "profile-upload-btn";
  uploadButton.textContent = "Upload Images";
  uploadButton.addEventListener("click", () => upload.click());

  card.appendChild(nickname);
  card.appendChild(bio);
  card.appendChild(instagram);
  card.appendChild(linkedin);
  card.appendChild(country);
  card.appendChild(mediaRow);
  card.appendChild(uploadButton);

  void refreshImages();

  card.appendChild(save);
  card.appendChild(status);
  panel.appendChild(card);
}

function renderStorePanel(
  panel: HTMLElement,
  state: {
    token: string;
    user: UserProfile | null;
    inGame: boolean;
    gameController: null | {
      destroy: () => void;
      setBlocks?: (a: string[], b: string[]) => void;
      blockUser?: (id: string) => void;
      setMutes?: (ids: string[]) => void;
      muteUser?: (id: string) => void;
    };
    menuVisible: boolean;
  }
) {
  panel.innerHTML = "";
  const card = document.createElement("div");
  card.className = "panel-card";
  card.innerHTML = `<h2>Store</h2>`;
  panel.appendChild(card);

  const search = document.createElement("input");
  search.type = "text";
  search.placeholder = "Search store...";
  card.appendChild(search);

  const list = document.createElement("div");
  list.className = "store-list";
  card.appendChild(list);

  const renderItems = (items: StoreItem[], query: string) => {
    list.innerHTML = "";
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? items.filter((item) => {
          const name = item.name.toLowerCase();
          const category = item.category.toLowerCase();
          const desc = (item.description ?? "").toLowerCase();
          return (
            name.includes(needle) ||
            category.includes(needle) ||
            desc.includes(needle)
          );
        })
      : items;

    if (filtered.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "No items match your search.";
      list.appendChild(empty);
      return;
    }

    filtered.forEach((item) => {
      const imageUrl = resolveStoreImageUrl(item.imageUrl);
      const row = document.createElement("div");
      row.className = "store-item";
      row.innerHTML = `
        <div>
          ${imageUrl ? `<img src="${imageUrl}" alt="${item.name}" />` : ""}
          <strong>${item.name}</strong>
          <span>${item.category}</span>
          <em>${item.description ?? ""}</em>
        </div>
        <div class="store-actions">
          <span>GG ${item.price}</span>
          <button>Buy</button>
        </div>
      `;
      row.querySelector("button")?.addEventListener("click", async () => {
        const ok = await confirmAction(`Buy ${item.name} for GG ${item.price}?`);
        if (!ok) return;
        const success = await buyStoreItem(state.token, item.id, 1);
        if (!success) return;
        await refreshUserState(state);
        updateMenuBalance();
        const nav = document.querySelector(".menu-nav");
        if (nav) {
          nav.querySelectorAll("button").forEach((btn) => btn.classList.remove("active"));
          nav.querySelector("button[data-tab='inventory']")?.classList.add("active");
        }
        void renderInventoryPanel(panel, state);
      });
      list.appendChild(row);
    });
  };

  void (async () => {
    const items = await fetchStoreItems();
    if (!items || items.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "No items available.";
      card.appendChild(empty);
      list.remove();
      return;
    }
    renderItems(items, "");
    search.addEventListener("input", () => renderItems(items, search.value));
  })();
}

function parseUser(raw: string | null): UserProfile | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
}

async function requestOtp(phone: string) {
  if (!phone) return false;
  const res = await fetch(`${API_BASE}/auth/request-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone })
  });
  return res.ok;
}

async function verifyOtp(phone: string, code: string): Promise<AuthResponse | null> {
  if (!phone || !code) return null;
  const res = await fetch(`${API_BASE}/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, code })
  });
  if (!res.ok) return null;
  return (await res.json()) as AuthResponse;
}

async function fetchMe(token: string): Promise<UserProfile | null> {
  const res = await fetch(`${API_BASE}/profile/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  return (await res.json()) as UserProfile;
}

async function updateProfile(
  token: string,
  payload: {
    nickname: string;
    bio: string;
    avatarUrl: string | null;
    instagram: string;
    linkedin: string;
    country: string;
  }
): Promise<UserProfile | null> {
  const res = await fetch(`${API_BASE}/profile/update`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) return null;
  return (await res.json()) as UserProfile;
}

async function renderSocialPanel(
  panel: HTMLElement,
  state: { token: string; user: UserProfile }
) {
  panel.innerHTML = "";
  const card = document.createElement("div");
  card.className = "panel-card";
  card.innerHTML = `<h2>Social Echo</h2><p>Loading...</p>`;
  panel.appendChild(card);

  const res = await fetch(`${API_BASE}/social/inbox`, {
    headers: { Authorization: `Bearer ${state.token}` }
  });
  if (!res.ok) {
    card.innerHTML = `<h2>Social Echo</h2><p>No data yet.</p>`;
    return;
  }
  const events = (await res.json()) as Array<{
    id: string;
    type: string;
    message: string | null;
    createdAt: string;
  }>;
  if (events.length === 0) {
    card.innerHTML = `<h2>Social Echo</h2><p>No gifts or compliments yet.</p>`;
    return;
  }
  card.innerHTML = `<h2>Social Echo</h2>`;
  const list = document.createElement("div");
  list.className = "social-list";
  events.forEach((event) => {
    const row = document.createElement("div");
    row.className = "social-item";
    row.innerHTML = `
      <strong>${event.type}</strong>
      <span>${event.message ?? ""}</span>
      <em>${new Date(event.createdAt).toLocaleString()}</em>
    `;
    list.appendChild(row);
  });
  card.appendChild(list);
}

function renderOnboarding(
  root: HTMLElement,
  state: {
    token: string;
    user: UserProfile | null;
    inGame: boolean;
    gameController: null | { destroy: () => void };
    menuVisible: boolean;
  }
) {
  if (!state.user) return;
  root.innerHTML = "";
  const container = document.createElement("div");
  container.className = "login";

  const card = document.createElement("div");
  card.className = "login-card";

  const title = document.createElement("h1");
  title.textContent = "Complete Profile";

  const nickname = document.createElement("input");
  nickname.placeholder = "Display name";
  nickname.value = state.user.nickname ?? "";

  const country = document.createElement("select");
  buildCountryOptions(country, state.user.country);

  const save = document.createElement("button");
  save.textContent = "Continue";

  const status = document.createElement("div");
  status.className = "login-status";

  save.addEventListener("click", async () => {
    status.textContent = "Saving...";
    const updated = await updateProfile(state.token, {
      nickname: nickname.value.trim(),
      bio: state.user?.bio ?? "",
      avatarUrl: state.user?.avatarUrl ?? null,
      instagram: state.user?.instagram ?? "",
      linkedin: state.user?.linkedin ?? "",
      country: country.value
    });
    if (!updated) {
      status.textContent = "Save failed.";
      return;
    }
    state.user = updated;
    localStorage.setItem(STORAGE_USER, JSON.stringify(updated));
    renderMenu(root, state);
  });

  card.appendChild(title);
  card.appendChild(nickname);
  card.appendChild(country);
  card.appendChild(save);
  card.appendChild(status);
  container.appendChild(card);
  root.appendChild(container);
}

function buildCountryOptions(select: HTMLSelectElement, value: string | null) {
  const countries = [
    { name: "United States", flag: "\u{1F1FA}\u{1F1F8}" },
    { name: "Canada", flag: "\u{1F1E8}\u{1F1E6}" },
    { name: "United Kingdom", flag: "\u{1F1EC}\u{1F1E7}" },
    { name: "Germany", flag: "\u{1F1E9}\u{1F1EA}" },
    { name: "France", flag: "\u{1F1EB}\u{1F1F7}" },
    { name: "Turkey", flag: "\u{1F1F9}\u{1F1F7}" },
    { name: "United Arab Emirates", flag: "\u{1F1E6}\u{1F1EA}" },
    { name: "Saudi Arabia", flag: "\u{1F1F8}\u{1F1E6}" },
    { name: "India", flag: "\u{1F1EE}\u{1F1F3}" },
    { name: "Pakistan", flag: "\u{1F1F5}\u{1F1F0}" },
    { name: "Iran", flag: "\u{1F1EE}\u{1F1F7}" },
    { name: "Japan", flag: "\u{1F1EF}\u{1F1F5}" },
    { name: "South Korea", flag: "\u{1F1F0}\u{1F1F7}" },
    { name: "Australia", flag: "\u{1F1E6}\u{1F1FA}" }
  ];
  select.innerHTML = "";
  countries.forEach((country) => {
    const option = document.createElement("option");
    option.value = country.name;
    option.textContent = `${country.flag} ${country.name}`;
    if (value === country.name) option.selected = true;
    select.appendChild(option);
  });
  if (!value && countries[0]) {
    select.value = countries[0].name;
  }
}

function ensureMenuToggle() {
  let button = document.getElementById("menu-toggle") as HTMLButtonElement | null;
  if (button) return button;
  button = document.createElement("button");
  button.id = "menu-toggle";
  button.textContent = "Menu";
  document.body.appendChild(button);
  return button;
}

function ensureGameOverlay() {
  let overlay = document.getElementById("game-overlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "game-overlay";
  const root = document.createElement("div");
  root.id = "game-root";
  overlay.appendChild(root);
  document.body.appendChild(overlay);
  return overlay;
}

async function openPublicProfile(
  token: string,
  id: string,
  selfId: string,
  onBlocked?: (blockedId: string) => void,
  onMuted?: (mutedId: string) => void
) {
  const res = await fetch(`${API_BASE}/profile/public/${id}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return;
  const data = (await res.json()) as {
    id: string;
    nickname: string | null;
    bio: string | null;
    avatarUrl: string | null;
    instagram: string | null;
    linkedin: string | null;
    country: string | null;
    createdAt: string;
    gameplaySeconds: number;
    images?: Array<{ id: string; url: string; isPrimary: boolean }>;
  };
  const modal = ensureProfileModal();
  window.dispatchEvent(new Event("gg:profile-opened"));
  let images = data.images ?? [];
  if (images.length === 0 && data.avatarUrl) {
    images = [{ id: "primary", url: data.avatarUrl, isPrimary: true }];
  }
  const primary = images.find((img) => img.isPrimary)?.url ?? data.avatarUrl;
  modal.querySelector("img")!.src = primary ?? "assets/avatar.png";
  modal.querySelector("h3")!.textContent = data.nickname ?? "Player";
  modal.querySelector(".profile-modal-bio")!.textContent = data.bio ?? "";
  modal.querySelector(".profile-modal-ig")!.textContent = data.instagram ?? "-";
  modal.querySelector(".profile-modal-li")!.textContent = data.linkedin ?? "-";
  modal.querySelector(".profile-modal-country")!.textContent = data.country ?? "-";
  const ageDays = Math.max(
    0,
    Math.floor((Date.now() - new Date(data.createdAt).getTime()) / 86400000)
  );
  const hours = (data.gameplaySeconds / 3600).toFixed(1);
  modal.querySelector(".profile-modal-age")!.textContent = `${ageDays} days`;
  modal.querySelector(".profile-modal-hours")!.textContent = `${hours} hours`;
  renderProfileSlider(modal, images);
  const blockButton = modal.querySelector(".profile-modal-block") as HTMLButtonElement | null;
  if (blockButton) {
    blockButton.style.display = id === selfId ? "none" : "block";
    blockButton.onclick = async () => {
      await blockUser(token, id);
      onBlocked?.(id);
      modal?.classList.remove("open");
      window.dispatchEvent(new Event("gg:profile-closed"));
    };
  }
  const muteButton = modal.querySelector(".profile-modal-mute") as HTMLButtonElement | null;
  if (muteButton) {
    muteButton.style.display = id === selfId ? "none" : "block";
    const muteState = await fetchMutes(token);
    const isMuted = muteState?.mutedIds.includes(id) ?? false;
    muteButton.textContent = isMuted ? "Unmute User" : "Mute User";
    muteButton.onclick = async () => {
      if (isMuted) {
        await unmuteUser(token, id);
      } else {
        await muteUser(token, id);
      }
      onMuted?.(id);
      modal?.classList.remove("open");
      window.dispatchEvent(new Event("gg:profile-closed"));
    };
  }
  const actionTab = modal.querySelector("[data-tab='action']") as HTMLButtonElement | null;
  const profileTab = modal.querySelector("[data-tab='profile']") as HTMLButtonElement | null;
  const profileSection = modal.querySelector(".profile-modal-section.profile") as HTMLElement | null;
  const actionSection = modal.querySelector(".profile-modal-section.action") as HTMLElement | null;
  if (actionTab && profileTab && profileSection && actionSection) {
    profileTab.onclick = () => {
      profileTab.classList.add("active");
      actionTab.classList.remove("active");
      profileSection.style.display = "block";
      actionSection.style.display = "none";
    };
    actionTab.onclick = async () => {
      actionTab.classList.add("active");
      profileTab.classList.remove("active");
      profileSection.style.display = "none";
      actionSection.style.display = "block";
      await renderActionTab(actionSection, token, id);
    };
  }
  modal.classList.add("open");
}

function ensureProfileModal() {
  let modal = document.getElementById("profile-modal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "profile-modal";
  modal.innerHTML = `
    <div class="profile-modal-card">
      <button class="profile-modal-close">Close</button>
      <div class="profile-modal-tabs">
        <button data-tab="profile" class="active">Profile</button>
        <button data-tab="action">Action</button>
      </div>
      <div class="profile-modal-section profile">
      <div class="profile-modal-slider">
        <button class="profile-slide-btn" data-dir="-1">‹</button>
        <img src="assets/avatar.png" alt="Avatar" />
        <button class="profile-slide-btn" data-dir="1">›</button>
      </div>
      <h3>Player</h3>
      <button class="profile-modal-block">Block User</button>
      <button class="profile-modal-mute">Mute User</button>
      <p class="profile-modal-bio"></p>
      <div class="profile-modal-links">
        <span>Instagram</span><span class="profile-modal-ig">-</span>
        <span>LinkedIn</span><span class="profile-modal-li">-</span>
        <span>Country</span><span class="profile-modal-country">-</span>
      </div>
      <div class="profile-modal-stats">
        <div><strong>Account Age</strong><span class="profile-modal-age">-</span></div>
        <div><strong>Gameplay</strong><span class="profile-modal-hours">-</span></div>
      </div>
      </div>
      <div class="profile-modal-section action" style="display:none;">
        <h4>Send Gift</h4>
        <div class="profile-modal-gifts">Loading...</div>
      </div>
    </div>
  `;
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      modal?.classList.remove("open");
      window.dispatchEvent(new Event("gg:profile-closed"));
    }
  });
  modal.querySelector(".profile-modal-close")?.addEventListener("click", () => {
    modal?.classList.remove("open");
    window.dispatchEvent(new Event("gg:profile-closed"));
  });
  document.body.appendChild(modal);
  return modal;
}

async function requestUploadUrl(
  token: string,
  name: string,
  contentType: string
): Promise<{ uploadUrl: string; publicUrl: string } | null> {
  const res = await fetch(`${API_BASE}/profile/upload-url`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ name, contentType })
  });
  if (!res.ok) return null;
  return (await res.json()) as { uploadUrl: string; publicUrl: string };
}

async function uploadFile(url: string, file: File) {
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": file.type
    },
    body: file
  });
  return res.ok;
}

async function fetchProfileImages(token: string) {
  const res = await fetch(`${API_BASE}/profile/images`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  return (await res.json()) as Array<{ id: string; url: string; isPrimary: boolean }>;
}

async function saveProfileImage(token: string, url: string) {
  const res = await fetch(`${API_BASE}/profile/images`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ url })
  });
  if (!res.ok) return null;
  return (await res.json()) as { id: string; url: string; isPrimary: boolean };
}

async function setPrimaryImage(token: string, imageId: string) {
  const res = await fetch(`${API_BASE}/profile/images/primary`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ imageId })
  });
  if (!res.ok) return null;
  return (await res.json()) as { ok: boolean; avatarUrl: string };
}

function renderImageGallery(
  container: HTMLElement,
  images: Array<{ id: string; url: string; isPrimary: boolean }>,
  token: string,
  state: { user: UserProfile },
  onPrimary?: (url: string) => void
) {
  container.innerHTML = "";
  const primaryUrl = images.find((img) => img.isPrimary)?.url;
  if (primaryUrl && state.user.avatarUrl !== primaryUrl) {
    state.user.avatarUrl = primaryUrl;
    onPrimary?.(primaryUrl);
    window.dispatchEvent(
      new CustomEvent("gg:local-avatar-updated", { detail: { url: primaryUrl } })
    );
  }
  images.forEach((img) => {
    const item = document.createElement("div");
    item.className = "profile-image-item";

    const thumb = document.createElement("div");
    thumb.className = "profile-thumb";
    const imgEl = document.createElement("img");
    imgEl.src = img.url;
    imgEl.alt = "Profile image";
    thumb.appendChild(imgEl);
    if (img.isPrimary) {
      thumb.classList.add("primary");
    }

    const actions = document.createElement("div");
    actions.className = "profile-image-actions";

    const setMain = document.createElement("button");
    setMain.type = "button";
    setMain.textContent = "Set Main";
    setMain.addEventListener("click", async () => {
      const result = await setPrimaryImage(token, img.id);
      if (result) {
        state.user.avatarUrl = result.avatarUrl;
        onPrimary?.(result.avatarUrl);
        window.dispatchEvent(
          new CustomEvent("gg:local-avatar-updated", { detail: { url: result.avatarUrl } })
        );
        renderImageGallery(
          container,
          images.map((i) => ({ ...i, isPrimary: i.id === img.id })),
          token,
          state,
          onPrimary
        );
      }
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      await deleteProfileImage(token, img.id);
      const updated = images.filter((i) => i.id !== img.id);
      renderImageGallery(container, updated, token, state, onPrimary);
    });

    actions.appendChild(setMain);
    actions.appendChild(remove);

    item.appendChild(thumb);
    item.appendChild(actions);
    container.appendChild(item);
  });
}

function renderProfileSlider(
  modal: HTMLElement,
  images: Array<{ id: string; url: string; isPrimary: boolean }>
) {
  const slider = modal.querySelector(".profile-modal-slider") as HTMLElement | null;
  const img = modal.querySelector(".profile-modal-slider img") as HTMLImageElement | null;
  if (!slider || !img) return;
  if (images.length === 0) return;
  let index = Math.max(
    0,
    images.findIndex((item) => item.isPrimary)
  );
  if (index < 0) index = 0;
  img.src = images[index]?.url ?? img.src;
  slider.querySelectorAll(".profile-slide-btn").forEach((btn) => {
    (btn as HTMLButtonElement).onclick = () => {
      const dir = Number((btn as HTMLElement).dataset.dir ?? "1");
      index = (index + dir + images.length) % images.length;
      img.src = images[index].url;
    };
  });

  let startX: number | null = null;
  img.onpointerdown = (event) => {
    startX = event.clientX;
  };
  img.onpointerup = (event) => {
    if (startX === null) return;
    const delta = event.clientX - startX;
    if (Math.abs(delta) > 40) {
      const dir = delta < 0 ? 1 : -1;
      index = (index + dir + images.length) % images.length;
      img.src = images[index].url;
    }
    startX = null;
  };
}

async function deleteProfileImage(token: string, imageId: string) {
  const res = await fetch(`${API_BASE}/profile/images/${imageId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.ok;
}

async function fetchBlocks(token: string) {
  const res = await fetch(`${API_BASE}/blocks`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  return (await res.json()) as {
    blockedIds: string[];
    blockedByIds: string[];
    blockedUsers: Array<{
      id: string;
      nickname: string | null;
      avatarUrl: string | null;
      country: string | null;
      bio: string | null;
    }>;
  };
}

async function fetchStoreItems(): Promise<StoreItem[] | null> {
  const res = await fetch(`${API_BASE}/store/items`);
  if (!res.ok) return null;
  return (await res.json()) as StoreItem[];
}

async function buyStoreItem(token: string, itemId: string, quantity: number) {
  const res = await fetch(`${API_BASE}/store/buy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ itemId, quantity })
  });
  return res.ok;
}

async function sendGift(
  token: string,
  toUserId: string,
  inventoryItemId: string
) {
  const res = await fetch(`${API_BASE}/gifts/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ toUserId, inventoryItemId })
  });
  if (res.ok) {
    const data = (await res.json().catch(() => null)) as
      | { cooldownSeconds?: number }
      | null;
    return { ok: true, cooldownSeconds: data?.cooldownSeconds };
  }
  if (res.status === 429) {
    const data = (await res.json().catch(() => null)) as
      | { retryAfter?: number }
      | null;
    return { ok: false, retryAfter: data?.retryAfter };
  }
  return { ok: false };
}

async function renderActionTab(container: HTMLElement, token: string, toUserId: string) {
  actionTabContext = { token, toUserId };
  container.innerHTML = `
    <div class="action-header">
      <h4>Send Gift</h4>
      <button class="action-store-btn">Go to Store</button>
    </div>
    <div class="profile-modal-gifts">Loading...</div>
  `;
  container.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target || target.tagName !== "BUTTON") return;
    const button = target as HTMLButtonElement;
    if (!button.disabled) return;
    const remaining = Math.max(0, Math.ceil((giftSendCooldownUntil - Date.now()) / 1000));
    if (remaining > 0) {
      showToast(`Gift sending is on cooldown. Try again in ${remaining}s.`);
    }
  });
  container.querySelector(".action-store-btn")?.addEventListener("click", () => {
    const menu = document.querySelector("[data-role='menu']") as HTMLElement | null;
    if (menu) {
      menu.classList.remove("menu-hidden");
    }
    const menuButton = document.getElementById("menu-toggle") as HTMLButtonElement | null;
    if (menuButton) {
      menuButton.style.display = "none";
    }
    const storeTab = document.querySelector("button[data-tab='store']") as HTMLButtonElement | null;
    storeTab?.click();
    const modal = document.getElementById("profile-modal");
    if (modal) {
      modal.classList.remove("open");
      window.dispatchEvent(new Event("gg:profile-closed"));
    }
  });
  const target = container.querySelector(".profile-modal-gifts") as HTMLElement | null;
  if (!target) return;
  const inventory = await fetchInventory(token);
  const items = inventory ?? [];
  if (items.length === 0) {
    target.textContent = "No gifts available. Buy from the store.";
    return;
  }
  target.innerHTML = "";
  items.forEach((inv) => {
    const item = inv.storeItem;
    const imageUrl = resolveStoreImageUrl(item.imageUrl);
    const row = document.createElement("div");
    row.className = "gift-item";
    row.innerHTML = `
        <div>
          ${imageUrl ? `<img src="${imageUrl}" alt="${item.name}" />` : ""}
          <strong>${item.name}</strong>
          <span>${item.category}</span>
        </div>
      <button>Send</button>
    `;
    const button = row.querySelector("button") as HTMLButtonElement | null;
    button?.addEventListener("click", async () => {
      if (!button || button.disabled) return;
      const ok = await confirmAction(`Send ${item.name} to this user?`);
      if (!ok) return;
      const result = await sendGift(token, toUserId, inv.id);
      if (result.ok) {
        const seconds = result.cooldownSeconds ?? 0;
        giftSendCooldownUntil = seconds > 0 ? Date.now() + seconds * 1000 : 0;
      } else if (typeof result.retryAfter === "number") {
        giftSendCooldownUntil = Date.now() + result.retryAfter * 1000;
        showToast(`Gift sending is on cooldown. Try again in ${result.retryAfter}s.`);
      }
      updateGiftSendButtons(container);
      if (!result.ok) return;
      await renderActionTab(container, token, toUserId);
    });
    target.appendChild(row);
  });
  updateGiftSendButtons(container);
}

async function renderInventoryPanel(
  panel: HTMLElement,
  state: {
    token: string;
    user: UserProfile | null;
    inGame: boolean;
    gameController: null | {
      destroy: () => void;
      setBlocks?: (a: string[], b: string[]) => void;
      blockUser?: (id: string) => void;
      setMutes?: (ids: string[]) => void;
      muteUser?: (id: string) => void;
    };
    menuVisible: boolean;
  }
) {
  panel.innerHTML = "";
  const card = document.createElement("div");
  card.className = "panel-card";
  card.innerHTML = `<h2>Inventory</h2>`;
  panel.appendChild(card);

  const search = document.createElement("input");
  search.type = "text";
  search.placeholder = "Search inventory...";
  card.appendChild(search);

  const items = await fetchInventory(state.token);
  if (!items || items.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No items yet.";
    card.appendChild(empty);
    return;
  }
  const now = Date.now();
  const activeLockUntil = items
    .filter((item) => item.isEquipped && item.expiresAt)
    .map((item) => Date.parse(item.expiresAt as string))
    .filter((ts) => Number.isFinite(ts) && ts > now)
    .sort((a, b) => b - a)[0];

  const equippedFreeze = items.find(
    (item) =>
      item.isEquipped &&
      item.storeItem.effects?.some((e) => e.effect.handlerKey === "freeze_nearby")
  );
  if (equippedFreeze) {
    const freezeEffect = equippedFreeze.storeItem.effects?.find(
      (e) => e.effect.handlerKey === "freeze_nearby"
    );
    if (freezeEffect) {
      const radius =
        typeof freezeEffect.effect.config?.radius === "number"
          ? freezeEffect.effect.config.radius
          : 120;
      const durationMs =
        typeof freezeEffect.effect.config?.durationMs === "number"
          ? freezeEffect.effect.config.durationMs
          : (freezeEffect.effect.durationSeconds ?? 3) * 1000;
      window.dispatchEvent(
        new CustomEvent("gg:effect-equipped", {
          detail: {
            key: "freeze",
            radius,
            durationMs,
            includeSelf: !!freezeEffect.effect.config?.includeSelf,
            expiresAt: equippedFreeze.expiresAt ?? null
          }
        })
      );
    }
  }
  const list = document.createElement("div");
  list.className = "inventory-list";
  const renderItems = (allItems: InventoryItem[], query: string) => {
    list.innerHTML = "";
    const needle = query.trim().toLowerCase();
    const filtered = (needle
      ? allItems.filter((item) => {
          const name = item.storeItem.name.toLowerCase();
          const category = item.storeItem.category.toLowerCase();
          return name.includes(needle) || category.includes(needle);
        })
      : allItems
    ).filter((item) => {
      const expiresAt = item.expiresAt ? Date.parse(item.expiresAt) : null;
      const isExpired = !!item.isExpired || (expiresAt !== null && expiresAt <= Date.now());
      return !isExpired;
    });

    if (filtered.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "No items match your search.";
      list.appendChild(empty);
      return;
    }

    filtered.forEach((item) => {
      const imageUrl = resolveStoreImageUrl(item.storeItem.imageUrl);
      const isEquippable = item.storeItem.isEquippable !== false;
      const expiresAt = item.expiresAt ? Date.parse(item.expiresAt) : null;
      const isExpired = !!item.isExpired || (expiresAt !== null && expiresAt <= Date.now());
      const row = document.createElement("div");
      row.className = "inventory-item";
      row.innerHTML = `
      <div>
        ${imageUrl ? `<img src="${imageUrl}" alt="${item.storeItem.name}" />` : ""}
        <strong>${item.storeItem.name}</strong>
        <span>${item.storeItem.category}</span>
        <div class="inventory-senders"></div>
      </div>
      <button class="inventory-equip">
        ${item.isEquipped ? "Equipped" : isExpired ? "Expired" : isEquippable ? "Equip" : "Not Equippable"}
      </button>
    `;
      const equipButton = row.querySelector(".inventory-equip") as HTMLButtonElement | null;
      if (equipButton) {
        const locked =
          typeof activeLockUntil === "number" &&
          Number.isFinite(activeLockUntil) &&
          activeLockUntil > Date.now() &&
          !item.isEquipped;
        equipButton.disabled = !isEquippable || item.isEquipped || isExpired || locked;
        if (item.isEquipped && expiresAt && expiresAt > Date.now()) {
          const remaining = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
          equipButton.textContent = `Equipped (${remaining}s)`;
        } else if (locked && typeof activeLockUntil === "number") {
          const remaining = Math.max(1, Math.ceil((activeLockUntil - Date.now()) / 1000));
          equipButton.textContent = `Locked (${remaining}s)`;
        }
        equipButton.addEventListener("click", async () => {
          if (!equipButton || equipButton.disabled) return;
          const result = await equipInventory(state.token, item.id, true);
          if (!result.ok) {
            if (typeof result.retryAfter === "number") {
              showToast(`Cooldown active. Try again in ${result.retryAfter}s.`);
            } else {
              showToast("Equip failed.");
            }
            return;
          }
          const equippedItem = result.item ?? item;
          const effects = equippedItem.storeItem.effects ?? [];
          const freeze = effects.find((e) => e.effect.handlerKey === "freeze_nearby");
          if (freeze) {
            const radius =
              typeof freeze.effect.config?.radius === "number"
                ? freeze.effect.config.radius
                : 120;
            const durationMs =
              typeof freeze.effect.config?.durationMs === "number"
                ? freeze.effect.config.durationMs
                : (freeze.effect.durationSeconds ?? 3) * 1000;
            const includeSelf = !!freeze.effect.config?.includeSelf;
            window.dispatchEvent(
              new CustomEvent("gg:effect-equipped", {
                detail: {
                  key: "freeze",
                  radius,
                  durationMs,
                  includeSelf,
                  expiresAt: equippedItem.expiresAt ?? null
                }
              })
            );
          }
          void renderInventoryPanel(panel, state);
        });
      }
      const sendersHost = row.querySelector(".inventory-senders") as HTMLElement | null;
      if (sendersHost && item.senders && item.senders.length > 0) {
        const visible = item.senders.slice(0, 2);
        visible.forEach((sender) => {
          const badge = document.createElement("div");
          badge.className = "sender-badge";
          badge.innerHTML = `
          <span class="sender-dot ${sender.isOnline ? "online" : "offline"}"></span>
          <span>${sender.name}</span>
        `;
          badge.addEventListener("click", () => {
            if (sender.id) {
              void openPublicProfile(state.token, sender.id, state.user!.id);
            }
          });
          sendersHost.appendChild(badge);
        });
        if (item.senders.length > 2) {
          const more = document.createElement("button");
          more.className = "sender-more";
          more.textContent = `Show more (${item.senders.length - 2})`;
          more.addEventListener("click", () => {
            showSendersModal(item.senders ?? [], state.token, state.user!.id);
          });
          sendersHost.appendChild(more);
        }
      }
      list.appendChild(row);
    });
  };
  renderItems(items, "");
  search.addEventListener("input", () => renderItems(items, search.value));
  if ((renderInventoryPanel as any)._timer) {
    window.clearInterval((renderInventoryPanel as any)._timer as number);
  }
  (renderInventoryPanel as any)._timer = window.setInterval(() => {
    renderItems(items, search.value);
  }, 1000);
  card.appendChild(list);
}

async function fetchInventory(token: string): Promise<InventoryItem[] | null> {
  const res = await fetch(`${API_BASE}/inventory`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  return (await res.json()) as InventoryItem[];
}

async function equipInventory(token: string, inventoryItemId: string, equipped: boolean) {
  const res = await fetch(`${API_BASE}/inventory/equip`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ inventoryItemId, equipped })
  });
  if (res.ok) {
    const data = (await res.json().catch(() => null)) as InventoryItem | null;
    return { ok: true, item: data ?? undefined };
  }
  if (res.status === 429 || res.status === 409) {
    const data = (await res.json().catch(() => null)) as { retryAfter?: number } | null;
    return { ok: false, retryAfter: data?.retryAfter };
  }
  return { ok: false };
}

async function refreshUserState(state: {
  token: string;
  user: UserProfile | null;
}) {
  const me = await fetchMe(state.token);
  if (!me) return;
  state.user = me;
  localStorage.setItem(STORAGE_USER, JSON.stringify(me));
}

function updateMenuBalance() {
  const balanceEl = document.querySelector(".menu-balance");
  const user = parseUser(localStorage.getItem(STORAGE_USER));
  const ggBalance =
    user?.balances?.find((b) => b.currency === "GG")?.balance ?? 0;
  if (balanceEl) {
    balanceEl.textContent = `GG ${ggBalance}`;
  }
}

function showSendersModal(
  senders: Array<{
    id: string | null;
    name: string;
    avatarUrl: string | null;
    count: number;
    isOnline: boolean;
    lastSeen: number | null;
  }>,
  token: string,
  selfId: string
) {
  let modal = document.getElementById("senders-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "senders-modal";
    modal.innerHTML = `
      <div class="senders-card">
        <button class="senders-close">Close</button>
        <h3>Senders</h3>
        <div class="senders-list"></div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector(".senders-close")?.addEventListener("click", () => {
      modal?.classList.remove("open");
    });
    modal.addEventListener("click", (event) => {
      if (event.target === modal) modal?.classList.remove("open");
    });
  }
  const list = modal.querySelector(".senders-list") as HTMLElement | null;
  if (!list) return;
  list.innerHTML = "";
  senders.forEach((sender) => {
    const row = document.createElement("div");
    row.className = "sender-row";
    row.innerHTML = `
      <div class="sender-info">
        <img src="${sender.avatarUrl ?? "assets/avatar.png"}" alt="Avatar" />
        <div>
          <strong>${sender.name}</strong>
          <span>${sender.isOnline ? "Online" : sender.lastSeen ? `Last seen ${formatRelative(sender.lastSeen)}` : "Offline"}</span>
        </div>
      </div>
      <div class="sender-actions">
        <span>×${sender.count}</span>
        <button ${sender.id ? "" : "disabled"}>View</button>
      </div>
    `;
    const viewBtn = row.querySelector("button") as HTMLButtonElement | null;
    if (viewBtn && sender.id) {
      viewBtn.addEventListener("click", () => {
        void openPublicProfile(token, sender.id!, selfId);
      });
    }
    list.appendChild(row);
  });
  modal.classList.add("open");
}

function formatRelative(timestamp: number) {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function confirmAction(message: string) {
  return new Promise<boolean>((resolve) => {
    let modal = document.getElementById("confirm-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "confirm-modal";
      modal.innerHTML = `
        <div class="confirm-card">
          <p class="confirm-message"></p>
          <div class="confirm-actions">
            <button data-action="cancel">Cancel</button>
            <button data-action="ok">Confirm</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }
    const messageEl = modal.querySelector(".confirm-message") as HTMLElement;
    messageEl.textContent = message;
    modal.classList.add("open");

    const cleanup = () => {
      modal?.classList.remove("open");
    };

    const okBtn = modal.querySelector("button[data-action='ok']") as HTMLButtonElement;
    const cancelBtn = modal.querySelector(
      "button[data-action='cancel']"
    ) as HTMLButtonElement;
    okBtn.onclick = () => {
      cleanup();
      resolve(true);
    };
    cancelBtn.onclick = () => {
      cleanup();
      resolve(false);
    };
  });
}

function updateGiftSendButtons(container: HTMLElement) {
  if (giftSendCooldownTimer) {
    window.clearInterval(giftSendCooldownTimer);
    giftSendCooldownTimer = null;
  }
  const buttons = Array.from(
    container.querySelectorAll(".gift-item button")
  ) as HTMLButtonElement[];
  if (buttons.length === 0) return;

  const applyState = () => {
    const now = Date.now();
    const remaining = Math.max(0, giftSendCooldownUntil - now);
    const active = remaining > 0;
    const label = active ? `Send (${formatCooldown(remaining)})` : "Send";
    buttons.forEach((btn) => {
      btn.disabled = active;
      btn.textContent = label;
    });
    return active;
  };

  const shouldTick = applyState();
  if (shouldTick) {
    giftSendCooldownTimer = window.setInterval(() => {
      const stillActive = applyState();
      if (!stillActive && giftSendCooldownTimer) {
        window.clearInterval(giftSendCooldownTimer);
        giftSendCooldownTimer = null;
      }
    }, 250);
  }
}

function formatCooldown(ms: number) {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

async function blockUser(token: string, blockedId: string) {
  const res = await fetch(`${API_BASE}/blocks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ blockedId })
  });
  return res.ok;
}

async function unblockUser(token: string, blockedId: string) {
  const res = await fetch(`${API_BASE}/blocks/${blockedId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.ok;
}

async function refreshBlockState(
  state: {
    token: string;
    user: UserProfile | null;
    inGame: boolean;
    gameController: null | {
      destroy: () => void;
      setBlocks?: (a: string[], b: string[]) => void;
      blockUser?: (id: string) => void;
    };
    menuVisible: boolean;
  },
  blockedId?: string
) {
  const blockState = await fetchBlocks(state.token);
  if (blockedId && state.gameController?.blockUser) {
    state.gameController.blockUser(blockedId);
  }
  if (blockState && state.gameController?.setBlocks) {
    state.gameController.setBlocks(blockState.blockedIds, blockState.blockedByIds);
  }
}

async function fetchMutes(token: string) {
  const res = await fetch(`${API_BASE}/mutes`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  return (await res.json()) as {
    mutedIds: string[];
    mutedUsers: Array<{
      id: string;
      nickname: string | null;
      avatarUrl: string | null;
      country: string | null;
      bio: string | null;
    }>;
  };
}

async function muteUser(token: string, mutedId: string) {
  const res = await fetch(`${API_BASE}/mutes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ mutedId })
  });
  return res.ok;
}

async function unmuteUser(token: string, mutedId: string) {
  const res = await fetch(`${API_BASE}/mutes/${mutedId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.ok;
}

async function refreshMuteState(
  state: {
    token: string;
    user: UserProfile | null;
    inGame: boolean;
    gameController: null | {
      destroy: () => void;
      setBlocks?: (a: string[], b: string[]) => void;
      blockUser?: (id: string) => void;
      setMutes?: (ids: string[]) => void;
      muteUser?: (id: string) => void;
    };
    menuVisible: boolean;
  },
  mutedId?: string
) {
  const muteState = await fetchMutes(state.token);
  if (mutedId && state.gameController?.muteUser) {
    state.gameController.muteUser(mutedId);
  }
  if (muteState && state.gameController?.setMutes) {
    state.gameController.setMutes(muteState.mutedIds);
  }
}

async function renderMutesPanel(
  panel: HTMLElement,
  state: {
    token: string;
    user: UserProfile | null;
    inGame: boolean;
    gameController: null | {
      destroy: () => void;
      setBlocks?: (a: string[], b: string[]) => void;
      blockUser?: (id: string) => void;
      setMutes?: (ids: string[]) => void;
      muteUser?: (id: string) => void;
    };
    menuVisible: boolean;
  }
) {
  if (!state.user) return;
  panel.innerHTML = "";
  const card = document.createElement("div");
  card.className = "panel-card";
  card.innerHTML = `<h2>Muted Users</h2>`;
  panel.appendChild(card);

  const data = await fetchMutes(state.token);
  if (!data || data.mutedUsers.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No muted users.";
    card.appendChild(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "block-list";
  data.mutedUsers.forEach((user) => {
    const row = document.createElement("div");
    row.className = "block-item";
    row.innerHTML = `
      <div class="block-info">
        <img src="${user.avatarUrl ?? "assets/avatar.png"}" alt="Avatar" />
        <div>
          <strong>${user.nickname ?? "User"}</strong>
          <span>${user.country ?? ""}</span>
        </div>
      </div>
    `;

    const actions = document.createElement("div");
    actions.className = "block-actions";
    const view = document.createElement("button");
    view.textContent = "View";
    view.addEventListener("click", () => {
      void openPublicProfile(state.token, user.id, state.user!.id);
    });
    const unmute = document.createElement("button");
    unmute.textContent = "Unmute";
    unmute.addEventListener("click", async () => {
      await unmuteUser(state.token, user.id);
      await refreshMuteState(state);
      void renderMutesPanel(panel, state);
    });
    actions.appendChild(view);
    actions.appendChild(unmute);
    row.appendChild(actions);
    list.appendChild(row);
  });
  card.appendChild(list);
}
async function renderBlocksPanel(
  panel: HTMLElement,
  state: {
    token: string;
    user: UserProfile | null;
    inGame: boolean;
    gameController: null | {
      destroy: () => void;
      setBlocks?: (a: string[], b: string[]) => void;
      blockUser?: (id: string) => void;
    };
    menuVisible: boolean;
  }
) {
  if (!state.user) return;
  panel.innerHTML = "";
  const card = document.createElement("div");
  card.className = "panel-card";
  card.innerHTML = `<h2>Blocked Users</h2>`;
  panel.appendChild(card);

  const data = await fetchBlocks(state.token);
  if (!data || data.blockedUsers.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No blocked users.";
    card.appendChild(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "block-list";
  data.blockedUsers.forEach((user) => {
    const row = document.createElement("div");
    row.className = "block-item";
    row.innerHTML = `
      <div class="block-info">
        <img src="${user.avatarUrl ?? "assets/avatar.png"}" alt="Avatar" />
        <div>
          <strong>${user.nickname ?? "User"}</strong>
          <span>${user.country ?? ""}</span>
        </div>
      </div>
    `;

    const actions = document.createElement("div");
    actions.className = "block-actions";
    const view = document.createElement("button");
    view.textContent = "View";
    view.addEventListener("click", () => {
      void openPublicProfile(state.token, user.id, state.user.id);
    });
    const unblock = document.createElement("button");
    unblock.textContent = "Unblock";
    unblock.addEventListener("click", async () => {
      await unblockUser(state.token, user.id);
      await refreshBlockState(state);
      void renderBlocksPanel(panel, state);
    });
    actions.appendChild(view);
    actions.appendChild(unblock);
    row.appendChild(actions);
    list.appendChild(row);
  });
  card.appendChild(list);
}

async function compressImage(file: File) {
  let workingFile = file;
  if (isHeicFile(file)) {
    workingFile = await convertHeicToJpeg(file);
    if (!workingFile) {
      console.error("HEIC conversion failed", { name: file.name, size: file.size });
      return null;
    }
  }
  const img = document.createElement("img");
  const url = URL.createObjectURL(workingFile);
  try {
    const loaded = await new Promise<HTMLImageElement>((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Image load failed"));
      img.src = url;
    });
    const maxSize = 512;
    const ratio = Math.min(maxSize / loaded.width, maxSize / loaded.height, 1);
    const width = Math.round(loaded.width * ratio);
    const height = Math.round(loaded.height * ratio);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      console.error("Image compression failed: missing 2D context", {
        name: file.name,
        type: file.type,
        size: file.size
      });
      return null;
    }
    ctx.drawImage(loaded, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.8)
    );
    if (!blob) {
      console.error("Image compression failed: toBlob returned null", {
        name: file.name,
        type: file.type,
        size: file.size
      });
      return null;
    }
    if (blob.size > 10 * 1024 * 1024) {
      console.error("Image compression failed: result too large", {
        name: file.name,
        size: blob.size
      });
      return null;
    }
    return new File([blob], workingFile.name.replace(/\.\w+$/, ".jpg"), {
      type: "image/jpeg"
    });
  } catch (err) {
    console.error("Image compression failed", {
      name: workingFile.name,
      type: workingFile.type,
      size: workingFile.size,
      error: err
    });
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function isHeicFile(file: File) {
  const lower = file.name.toLowerCase();
  return (
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    lower.endsWith(".heic") ||
    lower.endsWith(".heif")
  );
}

async function convertHeicToJpeg(file: File): Promise<File | null> {
  try {
    const mod = await import("heic2any");
    const heic2any = (mod as { default: Function }).default;
    const result = (await heic2any({
      blob: file,
      toType: "image/jpeg",
      quality: 0.9
    })) as Blob | Blob[];
    const blob = Array.isArray(result) ? result[0] : result;
    return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), {
      type: "image/jpeg"
    });
  } catch (err) {
    console.error("HEIC conversion error", err);
    return null;
  }
}
