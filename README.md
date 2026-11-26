# Hunger Royale

A live, interactive game-theory simulation and classroom tournament. Students configure continuous strategy sliders (such as health vs. damage or aggressive vs. defensive play) on their phones or laptops and compete against each other in real time.

## Architecture

- **`src/shared/`** — Shared TypeScript types and deterministic simulation engine.
- **`src/server/`** — Node.js + Express + WebSocket server managing tournament rooms, player submissions, and match execution.
- **`src/client/`** — React + Vite frontend with a mobile-friendly student controller and a projector-friendly host/arena view (with a built-in join QR code).

## Getting Started

```bash
pnpm install
pnpm dev
```

- Client (dev): `http://localhost:5173`
- Server (dev): `http://localhost:3000`

### Production Build

```bash
pnpm build
pnpm start
```

Serves both the built frontend and WebSocket server on a single port (`PORT`, default `3000`).
