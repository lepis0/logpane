# syntax=docker/dockerfile:1

# ---- stage 1: frontend build ----
FROM node:26-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# ---- stage 2: backend build ----
FROM golang:1.26-alpine AS backend-build
WORKDIR /app/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ .
COPY --from=frontend-build /app/frontend/dist ./internal/webui/dist
ARG VERSION=dev
ARG COMMIT=none
ARG BUILD_DATE=unknown
RUN CGO_ENABLED=0 GOOS=linux go build \
      -ldflags="-s -w \
        -X github.com/lepis0/logpane/backend/internal/version.Version=${VERSION} \
        -X github.com/lepis0/logpane/backend/internal/version.Commit=${COMMIT} \
        -X github.com/lepis0/logpane/backend/internal/version.BuildDate=${BUILD_DATE}" \
      -o /out/logpane ./cmd/server

# ---- stage 3: runtime ----
FROM alpine:3.24

# su-exec: drops root privileges to the requested PUID/PGID (see docker-entrypoint.sh).
# This is why the runtime base can't be scratch/distroless - we need a shell and
# basic user-management tools to support Unraid-style PUID/PGID permission handling.
RUN apk add --no-cache su-exec tzdata ca-certificates wget

COPY --from=backend-build /out/logpane /usr/local/bin/logpane
COPY docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

VOLUME ["/config"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/v1/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["/usr/local/bin/logpane"]
