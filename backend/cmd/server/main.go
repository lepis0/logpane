// Command server is the Logpane backend: it loads the on-disk YAML
// config, tails every enabled source, and serves the REST API, the
// live-tail WebSocket feed, and the embedded frontend over plain HTTP.
//
// There is no built-in authentication, session, or CORS handling — this
// binary is meant to sit behind whatever access control the operator
// already trusts (a reverse proxy, a private network, ...), same-origin
// with its own frontend in production and behind Vite's dev proxy in
// development.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/lepis0/logpane/backend/internal/api"
	"github.com/lepis0/logpane/backend/internal/config"
	"github.com/lepis0/logpane/backend/internal/tail"
	"github.com/lepis0/logpane/backend/internal/version"
	"github.com/lepis0/logpane/backend/internal/webui"
	"github.com/lepis0/logpane/backend/internal/ws"
)

func main() {
	logger := newLogger(getenv("LOGPANE_LOG_LEVEL", "info"))
	slog.SetDefault(logger)

	if err := run(logger); err != nil {
		logger.Error("fatal", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	configPath := getenv("LOGPANE_CONFIG", "/config/logpane.yaml")
	port := getenv("LOGPANE_PORT", "8080")

	logger.Info("starting logpane",
		"version", version.Get().Version,
		"commit", version.Get().Commit,
		"config", configPath,
		"port", port,
	)

	store, err := config.NewStore(configPath, logger)
	if err != nil {
		return err
	}
	defer func() {
		if err := store.Close(); err != nil {
			logger.Warn("error closing config store", "error", err)
		}
	}()

	manager := tail.NewManager(store.Get(), logger)
	store.Subscribe(manager.OnConfigChanged)
	defer manager.Close()

	hub := ws.NewHub(manager, store.Get().Settings.CoalesceWindowMs, logger)
	store.Subscribe(func(config.Config) { hub.BroadcastSourcesChanged() })

	router := api.NewRouter(store, manager, hub, webui.Handler(), logger)

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 0, // long-lived WS/download connections must not be cut off
		IdleTimeout:  120 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serveErr := make(chan error, 1)
	go func() {
		serveErr <- srv.ListenAndServe()
	}()

	select {
	case err := <-serveErr:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	case <-ctx.Done():
		logger.Info("shutdown signal received")
	}

	// Close WS connections first: http.Server.Shutdown waits for active
	// handlers to return, but a hijacked WebSocket handler blocks in its
	// read pump forever unless we close the underlying connection
	// ourselves.
	hub.Close()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Warn("graceful shutdown did not complete in time", "error", err)
	}

	if err := <-serveErr; err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func newLogger(level string) *slog.Logger {
	var lvl slog.Level
	switch level {
	case "debug":
		lvl = slog.LevelDebug
	case "warn":
		lvl = slog.LevelWarn
	case "error":
		lvl = slog.LevelError
	default:
		lvl = slog.LevelInfo
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: lvl}))
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
