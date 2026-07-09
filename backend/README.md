# Logpane backend

Go backend for Logpane: a self-hosted log file viewer. It tails plain
files/directories on disk (no Docker-container-log support), and serves
a REST + WebSocket API for the companion React frontend.

There is **no built-in authentication, session, or CORS handling** — it
is meant to run same-origin with its own frontend (production) or behind
Vite's dev proxy (development), sitting behind whatever access control
the operator already trusts.

## Running locally

```sh
go run ./cmd/server
```

By default this reads/writes its config at `/config/logpane.yaml` and
listens on port `8080`. On Windows or when developing without that path
available, point it somewhere writable instead:

```sh
LOGPANE_CONFIG=./logpane.yaml LOGPANE_PORT=8080 go run ./cmd/server
```

If the config file doesn't exist yet, it is created with an empty
source list on first run.

## Environment variables

| Variable             | Default                 | Meaning                                   |
|-----------------------|--------------------------|--------------------------------------------|
| `LOGPANE_CONFIG`      | `/config/logpane.yaml`  | Path to the YAML config file               |
| `LOGPANE_PORT`        | `8080`                  | HTTP listen port                           |
| `LOGPANE_LOG_LEVEL`   | `info`                  | `debug`, `info`, `warn`, or `error`        |

Logging is structured JSON via `log/slog`, written to stdout.

## API surface

All REST endpoints are under `/api/v1`:

- `GET  /api/v1/health` / `GET /api/v1/version`
- `GET  /api/v1/sources` / `POST /api/v1/sources` / `POST /api/v1/sources/validate`
- `GET  /api/v1/sources/{id}` / `PUT /api/v1/sources/{id}` / `DELETE /api/v1/sources/{id}`
- `GET  /api/v1/sources/{id}/lines?limit=&before=`
- `GET  /api/v1/sources/{id}/files`
- `GET  /api/v1/sources/{id}/download?file=`
- `POST /api/v1/sources/{id}/roll`
- `GET  /api/v1/ws` — live-tail WebSocket feed (subscribe/unsubscribe by source id;
  see `internal/ws/protocol.go` for the exact message shapes)

Everything else falls through to the embedded frontend (see
`internal/webui`), with SPA-style fallback to `index.html`.

## Building

```sh
go build -o logpane-server ./cmd/server
```

The frontend build output is expected at `internal/webui/dist/` at
build time (the Docker build copies it there before compiling; locally
it's just the `.gitkeep` placeholder, and the server degrades to a
plain 404 for non-API paths instead of failing to start).

## Tests

```sh
go build ./...
go vet ./...
gofmt -l .
go test ./...
```

(`go test -race` requires cgo, i.e. a C compiler on the build machine;
skip `-race` where one isn't available.)
