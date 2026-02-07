import type {
  AuthResponse,
  BlockState,
  InventoryItem,
  MuteState,
  ProfileImage,
  PublicProfile,
  StoreItem,
  UserProfile
} from "./types";

export const API_BASE = `http://${window.location.hostname || "localhost"}:8080`;

export async function requestOtp(phone: string) {
  if (!phone) return false;
  const res = await fetch(`${API_BASE}/auth/request-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone })
  });
  return res.ok;
}

export async function verifyOtp(phone: string, code: string): Promise<AuthResponse | null> {
  if (!phone || !code) return null;
  const res = await fetch(`${API_BASE}/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, code })
  });
  if (!res.ok) return null;
  return (await res.json()) as AuthResponse;
}

export async function fetchMe(token: string): Promise<UserProfile | null> {
  const res = await fetch(`${API_BASE}/profile/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  return (await res.json()) as UserProfile;
}

export async function updateProfile(
  token: string,
  payload: Partial<Pick<UserProfile, "nickname" | "bio" | "avatarUrl" | "instagram" | "linkedin" | "country">>
) {
  const res = await fetch(`${API_BASE}/profile/me`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) return null;
  return (await res.json()) as UserProfile;
}

export async function requestUploadUrl(token: string, name: string, contentType: string) {
  const res = await fetch(`${API_BASE}/profile/images/upload-url`, {
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

export async function uploadFile(url: string, file: File) {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file
  });
  return res.ok;
}

export async function fetchProfileImages(token: string) {
  const res = await fetch(`${API_BASE}/profile/images`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  return (await res.json()) as ProfileImage[];
}

export async function saveProfileImage(token: string, url: string) {
  const res = await fetch(`${API_BASE}/profile/images`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ url })
  });
  return res.ok;
}

export async function setPrimaryImage(token: string, imageId: string) {
  const res = await fetch(`${API_BASE}/profile/images/${imageId}/primary`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.ok;
}

export async function deleteProfileImage(token: string, imageId: string) {
  const res = await fetch(`${API_BASE}/profile/images/${imageId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.ok;
}

export async function fetchBlocks(token: string) {
  const res = await fetch(`${API_BASE}/blocks`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  return (await res.json()) as BlockState;
}

export async function blockUser(token: string, blockedId: string) {
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

export async function unblockUser(token: string, blockedId: string) {
  const res = await fetch(`${API_BASE}/blocks/${blockedId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.ok;
}

export async function fetchMutes(token: string) {
  const res = await fetch(`${API_BASE}/mutes`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  return (await res.json()) as MuteState;
}

export async function muteUser(token: string, mutedId: string) {
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

export async function unmuteUser(token: string, mutedId: string) {
  const res = await fetch(`${API_BASE}/mutes/${mutedId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.ok;
}

export async function fetchStoreItems(): Promise<StoreItem[] | null> {
  const res = await fetch(`${API_BASE}/store`);
  if (!res.ok) return null;
  return (await res.json()) as StoreItem[];
}

export async function buyStoreItem(token: string, itemId: string, quantity: number) {
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

export async function fetchInventory(token: string): Promise<InventoryItem[] | null> {
  const res = await fetch(`${API_BASE}/inventory`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  return (await res.json()) as InventoryItem[];
}

export async function sendGift(token: string, toUserId: string, inventoryItemId: string) {
  const res = await fetch(`${API_BASE}/gifts/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ toUserId, inventoryItemId })
  });
  if (res.ok) {
    return { ok: true, ...(await res.json()) } as {
      ok: true;
      cooldownSeconds?: number;
    };
  }
  if (res.status === 429) {
    return { ok: false, retryAfter: Number(res.headers.get("Retry-After") ?? "0") } as {
      ok: false;
      retryAfter?: number;
    };
  }
  return { ok: false } as { ok: false; retryAfter?: number };
}

export async function fetchPublicProfile(token: string, id: string) {
  const res = await fetch(`${API_BASE}/profile/public/${id}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  return (await res.json()) as PublicProfile;
}
