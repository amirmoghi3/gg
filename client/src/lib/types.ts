export type UserProfile = {
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

export type StoreItem = {
  id: string;
  name: string;
  category: string;
  price: number;
  description?: string | null;
  imageUrl?: string | null;
};

export type InventoryItem = {
  id: string;
  isEquipped: boolean;
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

export type AuthResponse = {
  token: string;
  user: UserProfile;
};

export type ProfileImage = {
  id: string;
  url: string;
  isPrimary: boolean;
  createdAt: string;
};

export type PublicProfile = {
  id: string;
  nickname: string | null;
  bio: string | null;
  avatarUrl: string | null;
  instagram: string | null;
  linkedin: string | null;
  country: string | null;
  createdAt: string;
  gameplaySeconds: number;
  images?: ProfileImage[];
  isBlocked?: boolean;
  isMuted?: boolean;
};

export type BlockState = {
  blockedIds: string[];
  blockedByIds: string[];
  blockedUsers: Array<{
    id: string;
    nickname: string | null;
    avatarUrl: string | null;
    country: string | null;
  }>;
};

export type MuteState = {
  mutedIds: string[];
  mutedUsers: Array<{
    id: string;
    nickname: string | null;
    avatarUrl: string | null;
    country: string | null;
    bio: string | null;
  }>;
};
