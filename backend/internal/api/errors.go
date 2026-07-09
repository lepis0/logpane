package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/lepis0/logpane/backend/internal/config"
)

// errorBody is the JSON shape of every non-2xx response: {"message": "..."}.
// The frontend's API client (frontend/src/api/client.ts) specifically looks
// for a top-level "message" string on error responses.
type errorBody struct {
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, errorBody{Message: message})
}

func decodeJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		return fmt.Errorf("invalid JSON body: %w", err)
	}
	return nil
}

// writeStoreError maps a config.Store sentinel error onto the appropriate
// HTTP status.
func writeStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, config.ErrNotFound):
		writeError(w, http.StatusNotFound, "source not found")
	case errors.Is(err, config.ErrImmutable):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, config.ErrInvalid):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}
