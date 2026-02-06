# agent.md — Codex Instructions (Social MMO PWA)

## Role
You are the lead engineer for a **web-first 2D social MMO** (PWA) with **proximity voice**, **smooth movement**, **map-based social spaces**, and **safety systems** (block/report/jail). Build in **small vertical slices**. Keep code minimal, testable, and self-hostable.

---

## Game Brief (What we’re building)
A **2D social MMO** where players appear as **rings with profile images** (like “soccer star” circle avatar). Players move smoothly in a shared world, see others nearby, and can **talk by proximity** (voice volume by distance). The “progression” is social: **aura, cosmetics, reputation, circles/friends**, not combat.

### Core features
- Web PWA playable on **mobile + desktop** (no app store required)
- **Smooth analog movement**
- **Large concurrency** (target 1000+ eventually via zones/shards + interest management)
- **Proximity voice** (WebRTC via self-hosted SFU)
- Social interactions: **gifts, compliments, aura**
- Social graph: **friend requests, circles**
- Safety: **block/report**, “jail” penalties after upheld reports, “restoration tokens” to reduce sentence (with constraints)

---

## Tech Stack (Decided)
### Client
- **TypeScript + Phaser 3 + Vite**
- PWA: manifest + service worker
- Rendering: non-pixelated (LINEAR filtering), no pixel-art settings

### Server
- **Node.js TypeScript**
- Real-time networking: **WebSocket** for game state
- Persistence: start in-memory → later Postgres/Redis (self-hosted)
- Voice: **self-hosted SFU** (prefer LiveKit OR mediasoup; choose one and stick to it)

### Infra (Self-host)
- Docker Compose for: server, db, redis (optional), SFU, TURN (coturn), reverse proxy (Caddy/Nginx) for TLS

---

## Non-Negotiables
- **Web-first** (PWA). No Unreal. Unity WebGL only if forced (not preferred).
- Must run **self-hosted** (no mandatory cloud services).
- Don’t build “everything at once.” Always deliver one working slice at a time.
- Never send global player lists. Always use **interest management** (nearby only).
- Safety systems must be real (server-enforced), not cosmetic.

---

## Visual / Camera / Movement Rules
### Avatar style
- Player = circle masked profile image + **ring outline**
- Add soft “shadow blob” under player
- Name label above
- Speaking indicator (pulse/ripple) when voice is active (later)

### Movement
- Smooth analog movement (floats). Not tile-locked.
- Client sends input; server is authority (basic anti-cheat).

### Map
- Using **Tiled JSON** import.
- User wants **32×32 tiles**.
- Map can be **orthogonal** (top-down grid) or **isometric** (diamond) — but must match JSON `orientation`.
- Do not assume 128×64 unless map JSON says so.

### Rendering quality (no pixelation)
- `pixelArt: false`
- Texture filtering: `LINEAR`
- Avoid “nearest neighbor” settings.
- Avoid fractional zoom if it causes blur; use a few zoom steps.

---

## Map Pipeline (Tiled → Phaser)
### What to support
- Export maps as `.json`
- Support multiple tile layers:
  - `ground`
  - `decor_back` (optional)
  - `decor_front` (optional)
  - Example from user: `ground`, `bridge`
- Support object layers for logic (when present):
  - `collisions` (rect/polygon)
  - `zones` (custom property: `zoneType`)

### Common pitfalls to detect and explain
- If `orientation` is `"orthogonal"` then treat as grid; do NOT apply isometric math.
- If `orientation` is `"isometric"` then diamond rules apply.
- Tile GIDs can be large (e.g. 595). Ensure TSX tilecount supports it; otherwise tiles will render wrong/blank.
- TSX `source` paths must resolve at runtime (avoid 404).

---

## Multiplayer Rules (1000-ready direction)
### Networking
- WebSocket real-time protocol.
- Client->Server: `hello`, `joinWorld`, `input`
- Server->Client: `welcome`, `zoneSnapshot`, `playerUpdate`
- Server sends snapshots at ~10Hz, client interpolates.

### Interest management
- Send only players in radius / grid buckets.
- Design code so we can later split into zones/shards.

---

## Voice Rules (Proximity Voice)
- Use WebRTC via a **self-hosted SFU** (LiveKit or mediasoup).
- Client joins a room based on zone/shard.
- Subscribe to nearest N speakers (8–16) with hysteresis.
- Distance-based volume.
- Push-to-talk option + clear mic permission UI.
- Must work on mobile browsers; requires HTTPS in production + TURN.

---

## Social Systems Rules
### Aura (make it concrete)
- `lifetimeAura`: never decreases (long-term identity)
- `activeAura`: can increase/decrease based on recent actions or penalties
- Gifts/compliments add to both (configurable)

### Gifts / Compliments
- Preset options only (no free text for MVP).
- Cooldowns and caps enforced on server (anti-spam).
- Show small animations + toasts on client.

### Friends / Circles
- Friend request should include context reason:
  - `met` | `talked` | `gifted` | `circle`
- Circles: create/join/invite/leave; show circle accent on ring.

---

## Moderation / Safety Rules
### Block
- Server-enforced: blocked players do not appear / cannot interact.

### Report
- Category + short text + metadata (time, zone, nearby players).
- “Upheld” decision can be simulated via admin endpoint for MVP.

### Jail
- Trigger: 3 upheld reports in rolling window (e.g. 14 days).
- Tiers and minimum serve:
  - Tier1: 24h (min 12h)
  - Tier2: 72h (min 48h)
  - Tier3: 7d (no early exit)
- While jailed: limited actions, grey ring, forced spawn in jail zone.
- “Restoration tokens” can reduce time only after min served, and only for tier1/2.

---

## Development Process (How you must work)
1. Implement the smallest possible slice that runs.
2. Always provide:
   - files changed
   - how to run
   - quick manual test steps
3. Do not refactor widely unless asked.
4. Keep types in `/shared` and reuse on client & server.
5. When uncertain, log and fail loudly with actionable errors.

---

## Output Format Requirements (for each change)
- Return a **file tree** and **full file contents** (or only changed files if requested).
- Add scripts:
  - `dev` for client
  - `dev` for server
  - root script to run both
- Explain any non-obvious decisions briefly.

---

## “Definition of Done” for each milestone
- Runs in desktop Chrome
- Works on Android Chrome
- iOS Safari best-effort
- Reconnect works after tab sleep
- No pull-to-refresh during gameplay (PWA + CSS)

---

## Starter Milestones (Build Order)
1. Monorepo scaffold: client/server/shared, “Hello world” Phaser scene
2. Player avatar: ring + masked image + shadow + name
3. Load Tiled JSON map and render layers
4. Smooth movement + camera follow
5. WebSocket multiplayer + interpolation + interest radius
6. Social actions: gifts/compliments + aura UI
7. Friends + circles
8. Block/report/jail + admin test endpoints
9. Proximity voice (SFU + TURN + TLS)
10. Zones/shards architecture

---

## Important Notes From User
- Wants **web app** usable on many devices (PWA).
- Wants **non-pixelated** visuals (smooth HD look).
- Map is created in **Tiled**, tiles are **32×32**.
- Game is **2D MMO social** (top-down/oblique vibe).
- Players are **circle avatars with profile images**.
