# web

React + TypeScript (Vite) step player: Input → Tile → Encode → Aggregate → Explain → Report.
Types come from `contracts/generated/ts`. Talks to the API at `/api` (dev proxy → :8000); falls back to
recorded runs in `public/replay/` (or force with `?replay`). Regenerate recordings: `uv run python scripts/record_demo.py`.
Dev: `npm run dev` · tests: `npm test` · smoke: `npm run build && npx playwright test`.
