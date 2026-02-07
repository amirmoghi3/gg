import Phaser from "phaser";
import { Room, RoomEvent, Track, RemoteAudioTrack } from "livekit-client";

const STORE_IMAGE_BASE =
  ((import.meta as any).env?.VITE_STORE_IMAGE_BASE as string | undefined) ?? "";
const API_BASE = `http://${window.location.hostname || "localhost"}:8080`;

function resolveStoreImageUrl(url?: string | null) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  const base = STORE_IMAGE_BASE.replace(/\/$/, "");
  const path = url.startsWith("/") ? url : `/${url}`;
  return base ? `${base}${path}` : url;
}

export type UserProfile = {
  id: string;
  phone: string;
  nickname: string | null;
  bio: string | null;
  avatarUrl: string | null;
  createdAt: string;
  gameplaySeconds: number;
};

type StoreItem = {
  id: string;
  name: string;
  category: string;
  price: number;
  description?: string | null;
  imageUrl?: string | null;
};

type InventoryItem = {
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

type PlayerState = {
  id: string;
  x: number;
  y: number;
  displayName: string;
  avatarUrl: string | null;
};

type ServerMessage =
  | { type: "welcome"; id: string; players: PlayerState[] }
  | { type: "playerUpdate"; player: PlayerState }
  | { type: "playerLeft"; id: string }
  | { type: "speaking"; id: string; speaking: boolean }
  | { type: "toast"; text: string }
  | {
      type: "giftOffer";
      gift: {
        id: string;
        fromUserId: string;
        fromName: string;
        fromAvatarUrl: string | null;
        itemId: string;
        itemName: string;
        itemImageUrl: string | null;
        expiresAt: string;
      };
    };

type StartGameOptions = {
  parentId: string;
  token: string;
  user: UserProfile;
  onOpenProfile: (id: string) => void;
  blockedIds?: string[];
  blockedByIds?: string[];
  mutedIds?: string[];
  ggBalance?: number;
};

export function startGame(options: StartGameOptions) {
  const blockedIds = new Set(options.blockedIds ?? []);
  const blockedByIds = new Set(options.blockedByIds ?? []);
  const mutedIds = new Set(options.mutedIds ?? []);
  const blockState = { blockedIds, blockedByIds };
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: options.parentId,
    backgroundColor: "#1b1f24",
    width: 960,
    height: 540,
    pixelArt: false,
    antialias: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH
    },
    scene: [new BootScene({ ...options, blockState })]
  };

  const game = new Phaser.Game(config);
  return {
    destroy: () => {
      game.destroy(true);
      document.getElementById("voice-ui")?.remove();
      document.getElementById("hud")?.remove();
      document.getElementById("minimap")?.remove();
      document.getElementById("balance-hud")?.remove();
      document.getElementById("gift-offer-modal")?.remove();
      document.getElementById("inventory-toggle")?.remove();
      document.getElementById("inventory-modal")?.remove();
      const overlay = document.getElementById("game-overlay");
      overlay?.classList.remove("game-active");
    },
    setBlocks: (nextBlocked: string[], nextBlockedBy: string[]) => {
      blockedIds.clear();
      blockedByIds.clear();
      nextBlocked.forEach((id) => blockedIds.add(id));
      nextBlockedBy.forEach((id) => blockedByIds.add(id));
    },
    setMutes: (nextMuted: string[]) => {
      mutedIds.clear();
      nextMuted.forEach((id) => mutedIds.add(id));
    },
    blockUser: (userId: string) => {
      blockedIds.add(userId);
    },
    muteUser: (userId: string) => {
      mutedIds.add(userId);
    }
  };
}

class BootScene extends Phaser.Scene {
  private inputVector = new Phaser.Math.Vector2();
  private player!: Phaser.GameObjects.Container;
  private myId: string | null = null;
  private otherPlayers = new Map<
    string,
    { obj: Phaser.GameObjects.Container; targetX: number; targetY: number }
  >();
  private blockedIds: Set<string>;
  private blockedByIds: Set<string>;
  private mutedIds: Set<string>;
  private socket: WebSocket | null = null;
  private sendTimer = 0;

  private keys!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    w: Phaser.Input.Keyboard.Key;
    a: Phaser.Input.Keyboard.Key;
    s: Phaser.Input.Keyboard.Key;
    d: Phaser.Input.Keyboard.Key;
    talk: Phaser.Input.Keyboard.Key;
  };

  private mapWidth = 0;
  private mapHeight = 0;

  private moveVector = new Phaser.Math.Vector2();
  private speed = 240;
  private turnSmoothing = 0.35;
  private swipeInput!: SwipeDirectionInput;

  private room: Room | null = null;
  private remoteAudio = new Map<string, { track: RemoteAudioTrack; lastVolume: number }>();
  private remoteSpeaking = new Map<string, boolean>();
  private voiceReady = false;
  private voiceTalking = false;
  private voiceUi: {
    root: HTMLDivElement;
    button: HTMLButtonElement;
    status: HTMLDivElement;
    talk: HTMLButtonElement;
    micSelect: HTMLSelectElement;
  } | null = null;
  private hud: {
    root: HTMLDivElement;
    count: HTMLDivElement;
  } | null = null;
  private minimapCanvas: HTMLCanvasElement | null = null;
  private minimapCtx: CanvasRenderingContext2D | null = null;
  private minimapSize = 160;
  private minimapPadding = 16;
  private ringDefault = 0x8b9bb0;
  private ringSpeaking = 0x3aa6ff;
  private collisionRadius = 22;
  private avatarLoadMargin = 120;
  private spawnZone = { x: 32, y: 32, width: 220, height: 220 };
  private balanceHud: HTMLDivElement | null = null;

  private proximityRange = 240;
  private maxSpeakers = 8;
  private selectedMicId: string | null = null;

  private localAvatarKey = "avatar";
  private displayName: string;
  private onOpenProfile: (id: string) => void;

  constructor(
    private options: StartGameOptions & {
      blockState: { blockedIds: Set<string>; blockedByIds: Set<string> };
    }
  ) {
    super("boot");
    this.displayName = options.user.nickname ?? options.user.phone;
    this.onOpenProfile = options.onOpenProfile;
    this.blockedIds = options.blockState.blockedIds;
    this.blockedByIds = options.blockState.blockedByIds;
    this.mutedIds = options.mutedIds ? new Set(options.mutedIds) : new Set();
  }

  preload() {
    this.load.setCORS("anonymous");
    this.load.tilemapTiledJSON("map", "assets/map.json");
    this.load.image("tiles", "assets/tiles.png");
    this.load.image("avatar", "assets/avatar.png");

    if (this.options.user.avatarUrl) {
      this.localAvatarKey = "avatar_local";
      this.load.image(this.localAvatarKey, this.options.user.avatarUrl);
    }
  }

  create() {
    const map = this.make.tilemap({ key: "map" });
    const tiles = map.addTilesetImage("tiles", "tiles");
    if (!tiles) {
      throw new Error("Tileset 'tiles' not found. Check map.json tileset name.");
    }

    const tilesTexture = this.textures.get("tiles");
    tilesTexture.setFilter(Phaser.Textures.FilterMode.LINEAR);

    const ground = map.createLayer("ground", tiles, 0, 0);
    if (!ground) {
      throw new Error("Layer 'ground' not found. Check map.json layer name.");
    }

    const camera = this.cameras.main;
    this.mapWidth = map.widthInPixels;
    this.mapHeight = map.heightInPixels;

    const zoomBoost = 1.7;
    const applyCamera = () => {
      camera.setBounds(0, 0, this.mapWidth, this.mapHeight);
      const zoomX = camera.width / this.mapWidth;
      const zoomY = camera.height / this.mapHeight;
      const zoom = Math.max(zoomX, zoomY) * zoomBoost;
      camera.setZoom(zoom);
      camera.roundPixels = true;
      camera.centerOn(this.mapWidth / 2, this.mapHeight / 2);
    };

    applyCamera();
    this.scale.on("resize", applyCamera);

    const playerX = this.mapWidth / 2;
    const playerY = this.mapHeight / 2;
    const spawnX = Phaser.Math.Clamp(
      this.spawnZone.x + Math.random() * this.spawnZone.width,
      0,
      this.mapWidth
    );
    const spawnY = Phaser.Math.Clamp(
      this.spawnZone.y + Math.random() * this.spawnZone.height,
      0,
      this.mapHeight
    );
    this.player = this.createPlayer(
      spawnX,
      spawnY,
      this.ringDefault,
      this.displayName,
      this.localAvatarKey
    );
    this.player.setDepth(10);

    camera.startFollow(this.player, true, 0.2, 0.2);

    const keyboard = this.input.keyboard;
    if (!keyboard) {
      throw new Error("Keyboard input not available.");
    }
    this.keys = {
      up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      w: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      a: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      s: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      d: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      talk: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.V)
    };

    this.keys.talk.on("down", () => this.setTalking(true));
    this.keys.talk.on("up", () => this.setTalking(false));

    this.swipeInput = new SwipeDirectionInput(this, {
      deadZone: 3,
      smoothFactor: 1,
      ignoreElementId: "voice-ui"
    });
    const handler = this.handleProfileClosed;
    const openHandler = this.handleProfileOpened;
    const avatarHandler = this.handleLocalAvatarUpdated;
    window.addEventListener("gg:profile-closed", handler);
    window.addEventListener("gg:profile-opened", openHandler);
    window.addEventListener("gg:local-avatar-updated", avatarHandler as EventListener);
    if ((this.game as any).events) {
      (this.game as any).events.once("destroy", () => {
        window.removeEventListener("gg:profile-closed", handler);
        window.removeEventListener("gg:profile-opened", openHandler);
        window.removeEventListener("gg:local-avatar-updated", avatarHandler as EventListener);
      });
    }

    this.connectSocket();
    this.buildVoiceUi();
    this.buildHud();
    this.buildMinimap();
    this.buildBalanceHud();
    this.buildInventoryUi();
  }

  private handleProfileClosed = () => {
    this.swipeInput.reset();
    this.swipeInput.setEnabled(true);
  };

  private handleProfileOpened = () => {
    this.swipeInput.reset();
    this.swipeInput.setEnabled(false);
  };

  private handleLocalAvatarUpdated = (event: Event) => {
    const detail = (event as CustomEvent<{ url: string | null }>).detail;
    const url = detail?.url ?? null;
    if (!url) return;
    const key = `avatar_local_${Date.now()}`;
    if (this.textures.exists(key)) {
      const avatar = this.player?.getData("avatar") as Phaser.GameObjects.Image | undefined;
      if (avatar) {
        avatar.setTexture(key).setDisplaySize(36, 36).setOrigin(0.5, 0.5);
      }
      return;
    }
    this.load.image(key, url);
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      const avatar = this.player?.getData("avatar") as Phaser.GameObjects.Image | undefined;
      if (avatar) {
        avatar.setTexture(key).setDisplaySize(36, 36).setOrigin(0.5, 0.5);
      }
    });
    this.load.start();
  };

  update(_: number, delta: number) {
    if (!this.player) return;

    this.inputVector.set(0, 0);
    const left = this.keys.left.isDown || this.keys.a.isDown;
    const right = this.keys.right.isDown || this.keys.d.isDown;
    const up = this.keys.up.isDown || this.keys.w.isDown;
    const down = this.keys.down.isDown || this.keys.s.isDown;

    if (left) this.inputVector.x -= 1;
    if (right) this.inputVector.x += 1;
    if (up) this.inputVector.y -= 1;
    if (down) this.inputVector.y += 1;

    if (this.inputVector.lengthSq() > 0) {
      this.inputVector.normalize();
    } else {
      this.inputVector.copy(this.swipeInput.getDirection());
    }

    this.moveVector.lerp(this.inputVector, this.turnSmoothing);

    const dt = delta / 1000;
    const moveX = this.moveVector.x * this.speed * dt;
    const moveY = this.moveVector.y * this.speed * dt;

    const nextX = Phaser.Math.Clamp(this.player.x + moveX, 0, this.mapWidth);
    const nextY = Phaser.Math.Clamp(this.player.y + moveY, 0, this.mapHeight);
    this.player.setPosition(nextX, nextY);
    this.resolveCollisions();
    this.updateAvatarMask(this.player);

    this.sendTimer += delta;
    if (this.socket && this.socket.readyState === WebSocket.OPEN && this.sendTimer > 100) {
      this.sendTimer = 0;
      this.socket.send(
        JSON.stringify({
          type: "input",
          x: this.player.x,
          y: this.player.y
        })
      );
    }

    for (const remote of this.otherPlayers.values()) {
      const dx = remote.targetX - remote.obj.x;
      const dy = remote.targetY - remote.obj.y;
      remote.obj.setPosition(remote.obj.x + dx * 0.15, remote.obj.y + dy * 0.15);
      this.updateAvatarMask(remote.obj);
    }

    this.updateHud();
    this.updateMinimap();
    this.updateProximityAudio();
    this.updateSpeakingRings();
    this.updateRemoteAvatarLoading();
    this.pruneBlockedPlayers();
  }

  private createPlayer(
    x: number,
    y: number,
    ringColor: number,
    name: string,
    avatarKey: string
  ) {
    const shadow = this.add.ellipse(0, 18, 40, 18, 0x000000, 0.25);
    const textureKey = this.textures.exists(avatarKey) ? avatarKey : "avatar";
    const avatar = this.add.image(0, 0, textureKey).setDisplaySize(36, 36);
    avatar.setOrigin(0.5, 0.5);
    const maskShape = this.add.graphics();
    maskShape.fillStyle(0xffffff, 1);
    maskShape.fillCircle(0, 0, 18);
    maskShape.setVisible(false);
    avatar.setMask(maskShape.createGeometryMask());

    const ring = this.add.circle(0, 0, 20, 0x000000, 0);
    ring.setStrokeStyle(3, ringColor, 1);

    const nameLabel = this.add
      .text(0, -32, name, {
        fontFamily: "\"Trebuchet MS\", Arial, sans-serif",
        fontSize: "12px",
        color: "#e8f1ff"
      })
      .setOrigin(0.5, 0.5);

    const container = this.add.container(x, y, [shadow, avatar, ring, nameLabel]);
    container.setData("ring", ring);
    container.setData("avatar", avatar);
    container.setData("mask", maskShape);
    container.setSize(48, 48);

    maskShape.setPosition(container.x, container.y);
    return container;
  }

  private connectSocket() {
    const host = window.location.hostname || "localhost";
    this.socket = new WebSocket(`ws://${host}:8080`);

    this.socket.onopen = () => {
      this.socket?.send(
        JSON.stringify({
          type: "join",
          token: this.options.token,
          x: this.player.x,
          y: this.player.y
        })
      );
    };

    this.socket.onmessage = (event) => {
      let message: ServerMessage | null = null;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.type === "welcome") {
        this.myId = message.id;
        for (const p of message.players) {
          if (p.id === this.myId) continue;
          if (this.shouldHide(p.id)) continue;
          this.upsertRemote(p);
        }
        this.updateVoiceStatus();
        return;
      }

      if (message.type === "playerUpdate") {
        if (message.player.id === this.myId) return;
        if (this.shouldHide(message.player.id)) return;
        this.upsertRemote(message.player);
        return;
      }

      if (message.type === "playerLeft") {
        const remote = this.otherPlayers.get(message.id);
        if (remote) {
          const mask = remote.obj.getData("mask") as Phaser.GameObjects.Graphics | undefined;
          mask?.destroy();
          remote.obj.destroy();
          this.otherPlayers.delete(message.id);
        }
        this.remoteSpeaking.delete(message.id);
        return;
      }

      if (message.type === "speaking") {
        if (message.id === this.myId) return;
        this.remoteSpeaking.set(message.id, message.speaking);
        return;
      }

      if (message.type === "toast") {
        this.showToast(message.text);
        return;
      }

      if (message.type === "giftOffer") {
        this.showGiftOfferModal(message.gift);
        return;
      }
    };
  }

  private upsertRemote(player: PlayerState) {
    if (this.shouldHide(player.id)) return;
    const remote = this.otherPlayers.get(player.id);
    if (!remote) {
      const obj = this.createPlayer(
        player.x,
        player.y,
        this.ringDefault,
        player.displayName,
        "avatar"
      );
      obj.setData("avatarUrl", player.avatarUrl ?? null);
      obj.setData("avatarUrlPrev", player.avatarUrl ?? null);
      obj.setData("avatarKey", "avatar");
      obj.setData("avatarLoading", false);
      obj.setInteractive({ cursor: "pointer" });
      obj.on("pointerdown", () => {
        if (player.id !== this.myId) {
          this.onOpenProfile(player.id);
        }
      });
      obj.setDepth(9);
      this.updateAvatarMask(obj);
      this.otherPlayers.set(player.id, {
        obj,
        targetX: player.x,
        targetY: player.y
      });
    } else {
      remote.targetX = player.x;
      remote.targetY = player.y;
      remote.obj.setData("avatarUrl", player.avatarUrl ?? null);
      const previousUrl = remote.obj.getData("avatarUrlPrev") as string | null | undefined;
      if (previousUrl !== (player.avatarUrl ?? null)) {
        remote.obj.setData("avatarKey", "avatar");
        remote.obj.setData("avatarLoading", false);
        const avatar = remote.obj.getData("avatar") as Phaser.GameObjects.Image | undefined;
        avatar?.setTexture("avatar").setDisplaySize(36, 36);
      }
      remote.obj.setData("avatarUrlPrev", player.avatarUrl ?? null);
      const avatar = remote.obj.getData("avatar") as Phaser.GameObjects.Image | undefined;
      const avatarKey = remote.obj.getData("avatarKey") as string | undefined;
      if (avatar && avatarKey) {
        avatar.setTexture(avatarKey).setDisplaySize(36, 36);
      }
    }
  }

  private shouldHide(id: string) {
    return this.blockedIds.has(id) || this.blockedByIds.has(id);
  }

  private pruneBlockedPlayers() {
    for (const [id, remote] of this.otherPlayers.entries()) {
      if (!this.shouldHide(id)) continue;
      const mask = remote.obj.getData("mask") as Phaser.GameObjects.Graphics | undefined;
      mask?.destroy();
      remote.obj.destroy();
      this.otherPlayers.delete(id);
    }
  }

  private updateAvatarMask(container: Phaser.GameObjects.Container) {
    const mask = container.getData("mask") as Phaser.GameObjects.Graphics | undefined;
    if (!mask) return;
    mask.setPosition(container.x, container.y);
  }

  private resolveCollisions() {
    const minDist = this.collisionRadius * 2;
    for (const remote of this.otherPlayers.values()) {
      const dx = this.player.x - remote.obj.x;
      const dy = this.player.y - remote.obj.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= 0 || dist >= minDist) continue;
      const overlap = minDist - dist;
      const nx = dx / dist;
      const ny = dy / dist;
      const push = overlap * 0.9;
      const nextX = Phaser.Math.Clamp(this.player.x + nx * push, 0, this.mapWidth);
      const nextY = Phaser.Math.Clamp(this.player.y + ny * push, 0, this.mapHeight);
      this.player.setPosition(nextX, nextY);
      remote.obj.setPosition(remote.obj.x - nx * push * 0.5, remote.obj.y - ny * push * 0.5);
    }
  }

  private ensureAvatarTexture(
    id: string,
    url: string | null,
    container: Phaser.GameObjects.Container,
    desiredKey: string
  ) {
    if (!url) return "avatar";
    const key = desiredKey;
    if (this.textures.exists(key)) return key;
    const loading = container.getData("avatarLoading") as boolean | undefined;
    if (loading) return "avatar";
    container.setData("avatarLoading", true);
    this.load.image(key, url);
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      const remote = this.otherPlayers.get(id);
      if (!remote) return;
      const avatar = remote.obj.getData("avatar") as Phaser.GameObjects.Image | undefined;
      if (avatar) {
        avatar.setTexture(key).setDisplaySize(36, 36).setOrigin(0.5, 0.5);
      }
      remote.obj.setData("avatarKey", key);
      remote.obj.setData("avatarLoading", false);
    });
    this.load.start();
    return "avatar";
  }

  private updateRemoteAvatarLoading() {
    const camera = this.cameras.main;
    const view = camera.worldView;
    const expanded = new Phaser.Geom.Rectangle(
      view.x - this.avatarLoadMargin,
      view.y - this.avatarLoadMargin,
      view.width + this.avatarLoadMargin * 2,
      view.height + this.avatarLoadMargin * 2
    );
    for (const [id, remote] of this.otherPlayers.entries()) {
      if (!Phaser.Geom.Rectangle.Contains(expanded, remote.obj.x, remote.obj.y)) continue;
      const url = remote.obj.getData("avatarUrl") as string | null;
      if (!url) continue;
      const desiredKey = this.makeAvatarKey(id, url);
      const avatarKey = remote.obj.getData("avatarKey") as string | undefined;
      if (avatarKey === desiredKey) continue;
      const key = this.ensureAvatarTexture(id, url, remote.obj, desiredKey);
      if (key !== "avatar") {
        const avatar = remote.obj.getData("avatar") as Phaser.GameObjects.Image | undefined;
        avatar?.setTexture(key).setDisplaySize(36, 36);
      }
    }
  }

  private makeAvatarKey(id: string, url: string) {
    let hash = 0;
    for (let i = 0; i < url.length; i += 1) {
      hash = (hash * 31 + url.charCodeAt(i)) | 0;
    }
    return `avatar_${id}_${Math.abs(hash)}`;
  }

  private buildVoiceUi() {
    const root = document.createElement("div");
    root.id = "voice-ui";

    const button = document.createElement("button");
    button.textContent = "Enable Voice";
    button.type = "button";

    const micSelect = document.createElement("select");
    micSelect.disabled = true;

    const talk = document.createElement("button");
    talk.textContent = "Hold to Talk";
    talk.type = "button";
    talk.disabled = true;

    const status = document.createElement("div");
    status.textContent = "Voice: offline";

    root.appendChild(button);
    root.appendChild(micSelect);
    root.appendChild(talk);
    root.appendChild(status);
    document.body.appendChild(root);

    button.addEventListener("click", () => {
      this.connectVoice();
    });

    micSelect.addEventListener("change", () => {
      this.selectedMicId = micSelect.value || null;
      if (this.selectedMicId) {
        localStorage.setItem("gg:mic", this.selectedMicId);
        this.applySelectedMic();
      }
    });

    talk.addEventListener("pointerdown", () => this.setTalking(true));
    talk.addEventListener("pointerup", () => this.setTalking(false));
    talk.addEventListener("pointerleave", () => this.setTalking(false));

    this.voiceUi = { root, button, status, talk, micSelect };
    this.updateVoiceStatus();
  }

  private updateVoiceStatus() {
    if (!this.voiceUi) return;
    if (!this.myId) {
      this.voiceUi.status.textContent = "Voice: waiting for join";
      this.voiceUi.button.disabled = true;
      this.voiceUi.micSelect.disabled = true;
      return;
    }
    this.voiceUi.button.disabled = this.voiceReady;
    this.voiceUi.talk.disabled = !this.voiceReady;
    this.voiceUi.micSelect.disabled = !this.voiceReady;
    const state = this.voiceReady
      ? this.voiceTalking
        ? "talking"
        : "ready (hold V / button)"
      : "offline";
    this.voiceUi.status.textContent = `Voice: ${state}`;
  }

  private async connectVoice() {
    if (this.voiceReady || !this.myId) return;
    this.updateVoiceStatus();
    try {
      await this.ensureMicPermission();
      const host = window.location.hostname || "localhost";
      const tokenRes = await fetch(
        `http://${host}:8080/voice/token?identity=${this.myId}&room=main`
      );
      if (!tokenRes.ok) {
        throw new Error(`Token request failed: ${tokenRes.status}`);
      }
      const { token } = (await tokenRes.json()) as { token: string };
      const url = (import.meta as any).env?.VITE_LIVEKIT_URL ?? `ws://${host}:7880`;

      const env = (import.meta as any).env ?? {};
      const turnUrl = env.VITE_TURN_URL as string | undefined;
      const turnUsername = env.VITE_TURN_USERNAME as string | undefined;
      const turnPassword = env.VITE_TURN_PASSWORD as string | undefined;

      const room = new Room(
        turnUrl
          ? {
              rtcConfig: {
                iceServers: [
                  {
                    urls: turnUrl,
                    username: turnUsername,
                    credential: turnPassword
                  }
                ]
              }
            }
          : undefined
      );
      this.room = room;

      room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        if (track.kind === Track.Kind.Audio) {
          this.remoteAudio.set(participant.identity, {
            track,
            lastVolume: 0
          });
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
        if (track.kind === Track.Kind.Audio) {
          this.remoteAudio.delete(participant.identity);
        }
      });

      room.on(RoomEvent.Disconnected, () => {
        this.remoteAudio.clear();
        this.voiceReady = false;
        this.voiceTalking = false;
        this.updateVoiceStatus();
      });

      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(false);
      this.voiceReady = true;
      await this.refreshMicList();
      await this.applySelectedMic();
      this.updateVoiceStatus();
    } catch (err) {
      console.error(err);
      if (this.voiceUi) {
        this.voiceUi.status.textContent = "Voice: failed (check server)";
      }
    }
  }

  private async setTalking(isTalking: boolean) {
    if (!this.room || !this.voiceReady) return;
    if (this.voiceTalking === isTalking) return;
    this.voiceTalking = isTalking;
    await this.applySelectedMic();
    await this.room.localParticipant.setMicrophoneEnabled(isTalking);
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "speaking", speaking: isTalking }));
    }
    this.updateVoiceStatus();
  }

  private async ensureMicPermission() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }

  private async refreshMicList() {
    if (!this.room || !this.voiceUi) return;
    const devices = await Room.getLocalDevices("audioinput");
    this.voiceUi.micSelect.innerHTML = "";
    for (const device of devices) {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `Microphone ${this.voiceUi.micSelect.length + 1}`;
      this.voiceUi.micSelect.appendChild(option);
    }
    const stored = localStorage.getItem("gg:mic");
    if (stored && devices.some((d) => d.deviceId === stored)) {
      this.selectedMicId = stored;
      this.voiceUi.micSelect.value = stored;
    } else if (devices[0]) {
      this.selectedMicId = devices[0].deviceId;
      this.voiceUi.micSelect.value = devices[0].deviceId;
    }
  }

  private async applySelectedMic() {
    if (!this.room || !this.selectedMicId) return;
    await this.room.switchActiveDevice("audioinput", this.selectedMicId);
  }

  private buildHud() {
    const root = document.createElement("div");
    root.id = "hud";
    root.style.right = `${this.minimapPadding}px`;
    root.style.top = `${this.minimapPadding + this.minimapSize + 12}px`;
    root.style.left = "auto";

    const count = document.createElement("div");
    count.id = "online-count";
    count.textContent = "Online: 1";

    root.appendChild(count);
    document.body.appendChild(root);

    this.hud = { root, count };
  }

  private showToast(text: string) {
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
    setTimeout(() => {
      toast.classList.add("hide");
      setTimeout(() => toast.remove(), 300);
    }, 2400);
  }

  private showGiftOfferModal(
    offer: Extract<ServerMessage, { type: "giftOffer" }>["gift"]
  ) {
    let modal = document.getElementById("gift-offer-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "gift-offer-modal";
      modal.innerHTML = `
        <div class="gift-offer-card">
          <h3>Incoming Gift</h3>
          <div class="gift-offer-body">
            <div class="gift-offer-media">
              <div class="gift-offer-avatar"></div>
              <div class="gift-offer-image"></div>
            </div>
            <div class="gift-offer-text">
              <strong class="gift-offer-sender"></strong>
              <span class="gift-offer-item"></span>
            </div>
          </div>
          <div class="gift-offer-progress">
            <div class="gift-offer-progress-bar"></div>
          </div>
          <div class="gift-offer-actions">
            <button data-action="reject">Reject</button>
            <button data-action="accept">Accept</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }
    const offerKey = `${offer.id}:${Date.now()}`;
    modal.dataset.offerKey = offerKey;

    const senderEl = modal.querySelector(".gift-offer-sender") as HTMLElement | null;
    const itemEl = modal.querySelector(".gift-offer-item") as HTMLElement | null;
    const imageHost = modal.querySelector(".gift-offer-image") as HTMLElement | null;
    const avatarHost = modal.querySelector(".gift-offer-avatar") as HTMLElement | null;
    const progressBar = modal.querySelector(
      ".gift-offer-progress-bar"
    ) as HTMLElement | null;
    const acceptBtn = modal.querySelector(
      "button[data-action='accept']"
    ) as HTMLButtonElement | null;
    const rejectBtn = modal.querySelector(
      "button[data-action='reject']"
    ) as HTMLButtonElement | null;

    if (senderEl) senderEl.textContent = offer.fromName;
    if (itemEl) itemEl.textContent = `Gift: ${offer.itemName}`;
    const imageUrl = resolveStoreImageUrl(offer.itemImageUrl);
    if (imageHost) {
      imageHost.innerHTML = imageUrl
        ? `<img src="${imageUrl}" alt="${offer.itemName}" />`
        : `<div class="gift-offer-fallback">GG</div>`;
    }
    if (avatarHost) {
      avatarHost.innerHTML = offer.fromAvatarUrl
        ? `<img src="${offer.fromAvatarUrl}" alt="${offer.fromName}" />`
        : `<div class="gift-offer-fallback">?</div>`;
    }
    if (acceptBtn) acceptBtn.disabled = false;
    if (rejectBtn) rejectBtn.disabled = false;
    if (progressBar) {
      progressBar.style.width = "100%";
    }

    let decided = false;
    const cleanup = () => {
      decided = true;
      modal?.classList.remove("open");
    };

    const decide = async (action: "accept" | "reject") => {
      if (modal?.dataset.offerKey !== offerKey) return;
      if (decided) return;
      decided = true;
      if (acceptBtn) acceptBtn.disabled = true;
      if (rejectBtn) rejectBtn.disabled = true;
      try {
        const ok = await this.decideGift(offer.id, action);
        if (!ok) {
          this.showToast("Gift decision failed.");
        }
      } finally {
        cleanup();
      }
    };

    if (acceptBtn) {
      acceptBtn.onclick = () => void decide("accept");
    }
    if (rejectBtn) {
      rejectBtn.onclick = () => void decide("reject");
    }

    modal.classList.add("open");

    const now = Date.now();
    const expiresAt = Number.isNaN(Date.parse(offer.expiresAt))
      ? now + 5000
      : Date.parse(offer.expiresAt);
    const visualDuration = Math.max(0, Math.min(5000, expiresAt - now));
    const decisionDuration = Math.max(visualDuration + 2000, 7000);
    const startedAt = performance.now();

    const tick = () => {
      if (modal?.dataset.offerKey !== offerKey) return;
      if (decided) return;
      const elapsed = performance.now() - startedAt;
      const pct = Math.max(0, 1 - elapsed / Math.max(visualDuration, 1));
      if (progressBar) {
        progressBar.style.width = `${Math.round(pct * 100)}%`;
      }
      if (elapsed < visualDuration) {
        requestAnimationFrame(tick);
      } else if (progressBar) {
        progressBar.style.width = "0%";
      }
    };
    requestAnimationFrame(tick);

    setTimeout(() => {
      if (modal?.dataset.offerKey !== offerKey) return;
      if (!decided) {
        void decide("reject");
      }
    }, decisionDuration);
  }

  private async decideGift(giftId: string, action: "accept" | "reject") {
    const host = window.location.hostname || "localhost";
    const res = await fetch(`http://${host}:8080/gifts/decide`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.options.token}`
      },
      body: JSON.stringify({ giftId, action })
    });
    return res.ok;
  }

  private updateHud() {
    if (!this.hud) return;
    const total = 1 + this.otherPlayers.size;
    this.hud.count.textContent = `Online: ${total}`;
  }

  private buildMinimap() {
    const canvas = document.createElement("canvas");
    canvas.id = "minimap";
    canvas.width = this.minimapSize;
    canvas.height = this.minimapSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Minimap 2D context not available.");
    }
    document.body.appendChild(canvas);
    this.minimapCanvas = canvas;
    this.minimapCtx = ctx;
  }

  private buildBalanceHud() {
    const root = document.createElement("div");
    root.id = "balance-hud";
    const gg = this.options.ggBalance ?? 0;
    root.innerHTML = `<span class="balance-icon">GG</span><span>${gg}</span>`;
    document.body.appendChild(root);
    this.balanceHud = root;
  }

  private buildInventoryUi() {
    let button = document.getElementById("inventory-toggle") as HTMLButtonElement | null;
    if (!button) {
      button = document.createElement("button");
      button.id = "inventory-toggle";
      button.type = "button";
      button.textContent = "Inventory";
      document.body.appendChild(button);
    }
    button.onclick = () => void this.openInventoryModal();
  }

  private async openInventoryModal() {
    let modal = document.getElementById("inventory-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "inventory-modal";
      modal.innerHTML = `
        <div class="inventory-modal-card">
          <button class="inventory-modal-close">Close</button>
          <h3>Inventory</h3>
          <div class="inventory-modal-body">
            <div class="inventory-modal-list">Loading...</div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      modal.addEventListener("click", (event) => {
        if (event.target === modal) this.closeInventoryModal();
      });
      modal
        .querySelector(".inventory-modal-close")
        ?.addEventListener("click", () => this.closeInventoryModal());
    }
    modal.classList.add("open");
    this.swipeInput.setEnabled(false);
    await this.renderInventoryModal(modal);
  }

  private closeInventoryModal() {
    const modal = document.getElementById("inventory-modal");
    modal?.classList.remove("open");
    this.swipeInput.setEnabled(true);
  }

  private async renderInventoryModal(modal: HTMLElement) {
    const host = modal.querySelector(".inventory-modal-list") as HTMLElement | null;
    if (!host) return;
    host.textContent = "Loading...";
    const items = await fetchInventory(this.options.token);
    if (!items || items.length === 0) {
      host.textContent = "No items yet.";
      return;
    }
    host.textContent = "";
    host.className = "inventory-modal-list inventory-list";
    items.forEach((item) => {
      const imageUrl = resolveStoreImageUrl(item.storeItem.imageUrl);
      const row = document.createElement("div");
      row.className = "inventory-item";
      row.innerHTML = `
        <div>
          ${imageUrl ? `<img src="${imageUrl}" alt="${item.storeItem.name}" />` : ""}
          <strong>${item.storeItem.name}</strong>
          <span>${item.storeItem.category}</span>
        </div>
      `;
      host.appendChild(row);
    });
  }

  private updateMinimap() {
    if (!this.minimapCanvas || !this.minimapCtx) return;
    const size = this.minimapSize;
    const ctx = this.minimapCtx;
    const scaleX = size / this.mapWidth;
    const scaleY = size / this.mapHeight;

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "rgba(11, 18, 32, 0.7)";
    ctx.strokeStyle = "rgba(42, 59, 85, 1)";
    ctx.lineWidth = 2;
    roundRect(ctx, 0, 0, size, size, 8, true, true);

    const px = this.player.x * scaleX;
    const py = this.player.y * scaleY;
    ctx.fillStyle = "#6ee7ff";
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffd54f";
    for (const remote of this.otherPlayers.values()) {
      const rx = remote.obj.x * scaleX;
      const ry = remote.obj.y * scaleY;
      ctx.beginPath();
      ctx.arc(rx, ry, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    const camera = this.cameras.main;
    const view = camera.worldView;
    const vx = Phaser.Math.Clamp(view.x, 0, this.mapWidth) * scaleX;
    const vy = Phaser.Math.Clamp(view.y, 0, this.mapHeight) * scaleY;
    const vw = Phaser.Math.Clamp(view.width, 0, this.mapWidth) * scaleX;
    const vh = Phaser.Math.Clamp(view.height, 0, this.mapHeight) * scaleY;
    ctx.strokeStyle = "rgba(255, 80, 80, 0.9)";
    ctx.lineWidth = 2;
    ctx.fillStyle = "rgba(255, 80, 80, 0.08)";
    ctx.fillRect(vx, vy, vw, vh);
    ctx.strokeRect(vx, vy, vw, vh);
  }

  private updateSpeakingRings() {
    const localRing = this.player.getData("ring") as Phaser.GameObjects.Arc | undefined;
    if (localRing) {
      localRing.setStrokeStyle(3, this.voiceTalking ? this.ringSpeaking : this.ringDefault, 1);
    }

    for (const [id, remote] of this.otherPlayers.entries()) {
      const ring = remote.obj.getData("ring") as Phaser.GameObjects.Arc | undefined;
      if (!ring) continue;
      const isSpeaking = this.remoteSpeaking.get(id) ?? false;
      const color = isSpeaking ? this.ringSpeaking : this.ringDefault;
      ring.setStrokeStyle(3, color, 1);
    }
  }

  private updateProximityAudio() {
    if (!this.room || !this.player) return;
    if (this.remoteAudio.size === 0) return;

    const distances: Array<{ id: string; dist: number }> = [];
    for (const id of this.remoteAudio.keys()) {
      const remote = this.otherPlayers.get(id);
      if (!remote) continue;
      const dx = remote.obj.x - this.player.x;
      const dy = remote.obj.y - this.player.y;
      distances.push({ id, dist: Math.hypot(dx, dy) });
    }

    distances.sort((a, b) => a.dist - b.dist);
    const audible = new Set(distances.slice(0, this.maxSpeakers).map((d) => d.id));

    for (const [id, entry] of this.remoteAudio.entries()) {
      const remote = this.otherPlayers.get(id);
      if (!remote || !audible.has(id) || this.mutedIds.has(id)) {
        entry.track.setVolume(0);
        continue;
      }
      const dx = remote.obj.x - this.player.x;
      const dy = remote.obj.y - this.player.y;
      const dist = Math.hypot(dx, dy);
      const volume = Phaser.Math.Clamp(1 - dist / this.proximityRange, 0, 1);
      entry.track.setVolume(volume);
      entry.lastVolume = volume;
    }
  }
}

type SwipeConfig = {
  deadZone: number;
  smoothFactor: number;
  ignoreElementId?: string;
};

class SwipeDirectionInput {
  private active = false;
  private pointerId: number | null = null;
  private lastPointer = new Phaser.Math.Vector2();
  private direction = new Phaser.Math.Vector2();
  private target = new Phaser.Math.Vector2();
  private deadZone: number;
  private smoothFactor: number;
  private ignoreElementId?: string;
  private enabled = true;

  constructor(private scene: Phaser.Scene, config: SwipeConfig) {
    this.deadZone = config.deadZone;
    this.smoothFactor = config.smoothFactor;
    this.ignoreElementId = config.ignoreElementId;

    scene.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.shouldIgnore(pointer)) return;
      this.active = true;
      this.pointerId = pointer.id;
      this.lastPointer.set(pointer.worldX, pointer.worldY);
      this.direction.set(0, 0);
      this.target.set(0, 0);
    });

    scene.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!this.active || this.pointerId !== pointer.id) return;
      const dx = pointer.worldX - this.lastPointer.x;
      const dy = pointer.worldY - this.lastPointer.y;
      this.lastPointer.set(pointer.worldX, pointer.worldY);

      const dist = Math.hypot(dx, dy);
      if (dist < this.deadZone) return;

      this.target.set(dx, dy).normalize();
      this.direction.lerp(this.target, this.smoothFactor);
    });

    scene.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      if (this.pointerId !== pointer.id) return;
      this.active = false;
      this.pointerId = null;
      this.direction.set(0, 0);
      this.target.set(0, 0);
    });
  }

  getDirection() {
    return this.direction;
  }

  reset() {
    this.active = false;
    this.pointerId = null;
    this.direction.set(0, 0);
    this.target.set(0, 0);
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      this.reset();
    }
  }

  private shouldIgnore(pointer: Phaser.Input.Pointer) {
    if (!this.enabled) return true;
    if (!this.ignoreElementId) return false;
    const target = pointer.event?.target as HTMLElement | null;
    if (!target) return false;
    return (
      !!target.closest(`#${this.ignoreElementId}`) ||
      !!target.closest("#public-profile-modal") ||
      !!target.closest("#gift-offer-modal") ||
      !!target.closest("#inventory-modal") ||
      !!target.closest("#inventory-toggle") ||
      !!target.closest("#confirm-modal")
    );
  }
}

async function fetchInventory(token: string): Promise<InventoryItem[] | null> {
  const res = await fetch(`${API_BASE}/inventory`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  return (await res.json()) as InventoryItem[];
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: boolean,
  stroke: boolean
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}
