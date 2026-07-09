#!/bin/sh
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$PUID" = "0" ]; then
  echo "[logpane] PUID=0, running as root"
  mkdir -p /config
  exec "$@"
fi

if ! grep -q ":${PGID}:" /etc/group; then
  addgroup -g "$PGID" logpane
fi
GROUP_NAME=$(awk -F: -v gid="$PGID" '$3==gid{print $1; exit}' /etc/group)

if ! grep -q ":${PUID}:" /etc/passwd; then
  adduser -D -H -u "$PUID" -G "$GROUP_NAME" logpane
fi
USER_NAME=$(awk -F: -v uid="$PUID" '$3==uid{print $1; exit}' /etc/passwd)

echo "[logpane] starting as ${USER_NAME}:${GROUP_NAME} (${PUID}:${PGID})"

# Only /config is chown'd - it's Logpane's own writable state. Log source
# mounts are intentionally left untouched: PUID/PGID should be set to match
# whatever already owns those files on the host, not the other way around.
mkdir -p /config
chown -R "$PUID:$PGID" /config

# exec (not a subshell) so the Go process becomes PID 1's replacement and
# receives SIGTERM directly from `docker stop` for a clean shutdown.
exec su-exec "${USER_NAME}:${GROUP_NAME}" "$@"
