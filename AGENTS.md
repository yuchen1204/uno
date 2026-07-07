# AGENTS.md

## Repo Shape

- This is not an npm workspace: run commands from `frontend/` or `backend/`, not the repo root.
- `frontend/` is a React 19 + Vite app. Its API client uses relative `/api` URLs, and Vite proxies `/api` to `http://localhost:8787` in local dev.
- `backend/` is the Cloudflare Worker entrypoint. `backend/wrangler.jsonc` serves `../frontend/dist` through the `ASSETS` binding and runs the Worker first for `/api/*`.
- `shared/` is imported by both TypeScript projects and is included by both `frontend/tsconfig.json` and `backend/tsconfig.json`; keep shared rules/constants there when behavior must match frontend and backend.
- Durable Object classes are exported from `backend/src/index.ts` for Wrangler bindings: `LobbyDOv2` and `GameRoomDOv2`.

## Commands

- Install dependencies separately: `cd frontend && npm install`, then `cd ../backend && npm install`.
- Frontend dev: `cd frontend && npm run dev`.
- Backend dev: `cd backend && npm run dev`.
- Frontend build/typecheck: `cd frontend && npm run build`.
- Backend typecheck: `cd backend && npm run typecheck`.
- Backend lint: `cd backend && npm run lint`.
- Backend tests: `cd backend && npm test`.
- Focused backend test file: `cd backend && npx vitest run test/rules.test.ts`.
- Deploy the combined app from `backend/` after building frontend: `cd frontend && npm run build`, then `cd ../backend && npm run deploy`.

## Cloudflare And Data

- Backend Wrangler config binds D1 as `DB`, KV as `SESSIONS`, Durable Objects as `LOBBY_DO` and `GAME_ROOM_DO`, and frontend static assets as `ASSETS`.
- Apply local D1 migrations from `backend/`, so Wrangler uses `backend/wrangler.jsonc`: `cd backend && npx wrangler d1 migrations apply uno-db --local`.
- Prefer `backend/migrations/` over the root `migrations/` directory; the backend migration includes the current `rooms.max_players` column used by `backend/src/rooms.ts`.
- Backend tests use `@cloudflare/vitest-pool-workers` with `backend/wrangler.jsonc`, so they may exercise Worker bindings rather than plain Node behavior.

## Entry Points

- API routing starts in `backend/src/index.ts`; room CRUD is in `backend/src/rooms.ts`, auth in `backend/src/auth.ts`, leaderboard in `backend/src/leaderboard.ts`.
- Game state lives mostly in the SQLite-backed Durable Object `backend/src/game/game-room-do.ts`; public room listing lives in `backend/src/game/lobby-do.ts`.
- Frontend navigation and persisted room/page state start in `frontend/src/App.tsx`; HTTP calls are centralized in `frontend/src/api.ts`.

## Verification Notes

- There is no frontend lint or test script in `frontend/package.json`; use `npm run build` there for the available TypeScript/build verification.
- Backend formatting is configured only under `backend/.prettierrc`, with double quotes, semicolons, trailing commas, 2 spaces, and `printWidth` 120.
- Existing source and UI strings are largely Chinese; preserve that unless the change explicitly targets localization.
