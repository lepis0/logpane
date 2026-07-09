package api

import (
	"net/http"

	"github.com/lepis0/logpane/backend/internal/version"
)

func healthHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func versionHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, version.Get())
}
