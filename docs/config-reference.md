# Configuration reference

Logpane stores all of its configuration in a single YAML file, `logpane.yaml`,
inside the `/config` volume (e.g. `/mnt/user/appdata/logpane/logpane.yaml` on
Unraid). The file is created with sensible defaults on first run if it
doesn't already exist.

You can edit it in two ways:

- **From the UI** (Sources page) — the recommended way for day-to-day changes.
- **By hand**, directly on disk — Logpane watches the file and reloads
  automatically when it changes.

> **Note:** the YAML parser Logpane uses does not preserve comments when it
> rewrites the file. If you hand-add comments and then make a change from the
> UI, your comments will be lost on the next save. Prefer UI edits once the
> file exists, or keep your own annotated copy elsewhere.

## Top-level structure

```yaml
schemaVersion: 1

settings:
  maxInitialLines: 2000
  coalesceWindowMs: 50

sources:
  - id: nginx-access
    name: Nginx — access log
    type: file
    path: /logs/hostvar/nginx/access.log
    color: "#22c55e"
    tags: [nginx, web]
    excludePatterns: []
    allowRoll: true
    enabled: true

  - id: docker-containers
    name: Docker container logs
    type: glob
    path: /logs/docker/*/*.log
    color: "#3b82f6"
    tags: [docker]
    excludePatterns: ["*.gz"]
    allowRoll: false
    enabled: true
```

### `schemaVersion`

Integer. Identifies the config file layout so future versions of Logpane can
migrate older files automatically. Don't edit this by hand.

### `settings`

Global behavior that applies to all sources.

| Field | Type | Default | Description |
|---|---|---|---|
| `maxInitialLines` | int | `2000` | How many lines to back-fill from the end of a file when a source is first opened in the UI. Higher values give more scrollback but take longer to load on very large files. |
| `coalesceWindowMs` | int | `50` | How long the server batches newly-tailed lines before pushing them to connected browsers over WebSocket, in milliseconds. Lower values feel more "instant" but send more, smaller WebSocket frames under high log volume. |

### `sources`

A list of log sources. Each entry:

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Stable unique identifier. Generated automatically when a source is created from the UI — avoid changing it by hand, since it's used as the WebSocket subscription key. |
| `name` | string | yes | Display name shown in the sidebar. |
| `type` | `file` \| `glob` | yes | `file` points at exactly one log file. `glob` points at a directory pattern (e.g. `/logs/docker/*/*.log`) that can match multiple files; the most recently modified match is tailed live, and the rest are browsable but not streamed. |
| `path` | string | yes | Absolute path *as seen inside the container*. Must live under a mounted volume — see the main [README](../README.md) for mount examples. |
| `color` | string (hex) | no | Accent color used for this source's indicator dot and log lines in the UI. Auto-assigned if omitted. |
| `tags` | string[] | no | Free-form labels for grouping/filtering sources in the sidebar. |
| `excludePatterns` | string[] | no | Glob patterns to exclude when `type: glob` matches files (e.g. `["*.gz", "*.1"]`). Ignored for `type: file`. |
| `allowRoll` | bool | no (`false`) | Whether the "roll" (truncate) action is available for this source from the UI. Leave `false` for sources you don't own or that are managed by another process's log rotation. |
| `enabled` | bool | no (`true`) | Set to `false` to keep a source in the config without tailing or showing it. |

## Permissions

Logpane reads (and, for `allowRoll` sources, truncates) files using the
container's runtime user, controlled by the `PUID`/`PGID` environment
variables — see the [README](../README.md). If a source's files aren't
readable by that user/group on the host, Logpane will report a permission
error for that source rather than failing to start.
