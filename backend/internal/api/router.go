// Package api assembles the /api/v1 REST surface: sources CRUD, validation,
// backfill, file listing, download, and roll — plus /health and /version.
// The live-tail WebSocket feed lives in package ws and is mounted here at
// /api/v1/ws; everything else under / falls through to uiHandler, which
// serves the embedded frontend (see internal/webui) with SPA-style
// fallback to index.html.
package api

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/lepis0/logpane/backend/internal/config"
	"github.com/lepis0/logpane/backend/internal/tail"
)

// NewRouter builds the full HTTP handler: the /api/v1 tree plus a
// catch-all fallback to uiHandler for everything else (the embedded
// frontend). wsHandler is mounted at /api/v1/ws as-is (it does its own
// upgrade handling; there is nothing else for chi to do with it).
func NewRouter(store *config.Store, manager *tail.Manager, wsHandler http.Handler, uiHandler http.Handler, logger *slog.Logger) chi.Router {
	if logger == nil {
		logger = slog.Default()
	}

	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(loggingMiddleware(logger))
	r.Use(middleware.Compress(5))

	h := &Handler{store: store, manager: manager}

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/health", healthHandler)
		r.Get("/version", versionHandler)

		r.Route("/sources", func(r chi.Router) {
			r.Get("/", h.listSources)
			r.Post("/", h.createSource)
			r.Post("/validate", h.validateSource)

			r.Route("/{id}", func(r chi.Router) {
				r.Get("/", h.getSource)
				r.Put("/", h.updateSource)
				r.Delete("/", h.deleteSource)
				r.Get("/lines", h.getLines)
				r.Get("/files", h.getFiles)
				r.Get("/download", h.downloadSource)
				r.Post("/roll", h.rollSource)
			})
		})

		if wsHandler != nil {
			r.Handle("/ws", wsHandler)
		}
	})

	if uiHandler != nil {
		r.NotFound(uiHandler.ServeHTTP)
	} else {
		r.NotFound(func(w http.ResponseWriter, r *http.Request) {
			writeError(w, http.StatusNotFound, "not found")
		})
	}

	return r
}

// loggingMiddleware logs one structured line per request via slog, in
// place of chi's built-in middleware.Logger (which writes plain text, not
// slog records, to a fixed writer).
func loggingMiddleware(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)
			logger.Info("http request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", ww.Status(),
				"bytes", ww.BytesWritten(),
				"duration_ms", time.Since(start).Milliseconds(),
				"remote", r.RemoteAddr,
			)
		})
	}
}
