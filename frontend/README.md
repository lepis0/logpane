# Logpane frontend

React + TypeScript UI for Logpane, a self-hosted log file viewer. Talks to the
Go backend via a JSON REST API and a single shared WebSocket, both under
`/api/v1`.

## Stack

- Vite + React 19 + TypeScript
- Tailwind CSS v4 (CSS-first `@theme`, no separate config file)
- Radix UI primitives (dialog, dropdown menu, tooltip, switch, select) for
  accessible behavior; Tailwind handles all visuals
- Zustand for client UI state (`stores/uiStore.ts`) and the high-frequency
  live log line buffer (`stores/logStore.ts`, a vanilla store)
- TanStack Query for server state (sources CRUD)
- `react-resizable-panels` for the resizable multi-pane grid
- `react-virtuoso` for virtualized log line rendering
- `sonner` for toasts

## Development

```bash
npm install
npm run dev
```

The dev server proxies `/api/*` (REST and the `/api/v1/ws` WebSocket) to
`http://localhost:8080`, so run the Go backend alongside it. The UI still
loads and shows a "backend unreachable" indicator if the backend isn't up.

## Building

```bash
npm run build
```

Produces `dist/`, which the Go backend serves at the same origin in
production (no CORS handling needed - see `vite.config.ts`).

## Checks

```bash
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm run test       # vitest
npm run build      # production build
```

## Project layout

```
src/
  api/        REST client, source endpoints, WebSocket client
  stores/     zustand stores (ephemeral UI state, live log line buffer)
  hooks/      WebSocket feed subscription, autoscroll, keyboard shortcuts
  components/
    layout/   Sidebar, PaneGrid
    viewer/   Per-pane log view (search, virtualized list, line rendering)
    sources/  Source create/edit dialog and manager
    common/   Small shared UI primitives
  lib/        Log-level detection, search highlighting, formatting helpers
  types/      Shared TypeScript types matching the backend API contract
```
