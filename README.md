# Logpane

A modern, self-hosted log file viewer for your browser — a spiritual successor to
[Logarr](https://github.com/Monitorr/logarr), rebuilt with a Go backend and a React
frontend, shipped as a single lightweight Docker image.

Point Logpane at log files or directories on disk, and watch them live from a clean,
dark-mode-first web UI: split panes instead of stacked tiles, regex search with
highlighting, automatic log-level coloring, pause/resume autoscroll, and one-click
download or truncate ("roll") of a source.

> **Status:** early development — not yet ready for production use.

## Features (planned for v1)

- Live tailing of log files and directories, streamed over WebSocket
- Multi-pane / split-view layout for watching several sources at once
- Regex or plain-text search with match highlighting and "only matching lines" filter
- Automatic log-level highlighting (ERROR/WARN/INFO/DEBUG)
- Pause/resume autoscroll, dark mode by default
- Source management from the UI (add/edit/remove), backed by a single YAML config file
- Download and truncate ("roll") actions per source
- Single Docker image, PUID/PGID support for Unraid-style permission handling
- No built-in auth — intended to sit behind your LAN or a reverse proxy (e.g. Authelia)

## Running on Unraid / Docker

See [`docker-compose.yml`](./docker-compose.yml) for a ready-to-use example. In short:

```bash
docker run -d \
  --name logpane \
  -p 8080:8080 \
  -v /mnt/user/appdata/logpane:/config \
  -v /var/log:/logs/hostvar:ro \
  -e PUID=99 -e PGID=100 -e TZ=Europe/Helsinki \
  ghcr.io/<owner>/logpane:latest
```

Then open `http://<unraid-ip>:8080`.

## Development

See [`backend/`](./backend) and [`frontend/`](./frontend) for the Go server and React
app respectively, and [`docs/config-reference.md`](./docs/config-reference.md) for the
configuration file format.

## License

[MIT](./LICENSE)
