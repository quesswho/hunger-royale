# Hunger Royale

A live, interactive game-theory simulation and classroom tournament. Students configure continuous strategy sliders (such as health vs. damage or aggressive vs. defensive play) on their phones or laptops and compete against each other in real time.

## Architecture

- **`src/shared/`** — Shared TypeScript types and deterministic simulation engine.
- **`src/server/`** — Node.js + Express + WebSocket server managing tournament rooms, PIN-protected host controls, and match execution.
- **`src/client/`** — React + Vite frontend with three routes:
  - `/` — Student player view (name entry + strategy sliders).
  - `/projector` — Read-only projector display with the join QR code and live lobby.
  - `/host` — PIN-protected admin panel (start/reset rounds, lock lobby, kick players).

## Getting Started

```bash
pnpm install
HOST_PIN=123456 pnpm dev
```

- Client (dev): `http://localhost:5173`
- Server (dev): `http://localhost:3000`
- If `HOST_PIN` is omitted, a random 6-digit PIN is generated and printed to the server terminal on startup.

### Production Build

```bash
pnpm build
HOST_PIN=your-secret-pin pnpm start
```

Serves both the built frontend and WebSocket server on a single port (`PORT`, default `3000`).
