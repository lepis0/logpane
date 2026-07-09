package api

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/lepis0/logpane/backend/internal/config"
	"github.com/lepis0/logpane/backend/internal/logsource"
	"github.com/lepis0/logpane/backend/internal/tail"
)

// Handler holds the shared dependencies for every /api/v1/sources* route.
// Its JSON DTOs below deliberately mirror frontend/src/types/source.ts and
// frontend/src/types/logLine.ts field-for-field — the frontend is built
// independently against this exact wire shape.
type Handler struct {
	store   *config.Store
	manager *tail.Manager
}

// ---- DTOs --------------------------------------------------------------

type sourceStatusDTO struct {
	ActiveFile       string `json:"activeFile"`
	MatchedFileCount int    `json:"matchedFileCount"`
	Size             int64  `json:"size"`
	ModTime          string `json:"modTime"`
	Readable         bool   `json:"readable"`
	LastError        string `json:"lastError"`
}

type sourceDTO struct {
	ID              string          `json:"id"`
	Name            string          `json:"name"`
	Type            string          `json:"type"`
	Path            string          `json:"path"`
	Color           string          `json:"color"`
	Tags            []string        `json:"tags"`
	ExcludePatterns []string        `json:"excludePatterns"`
	AllowRoll       bool            `json:"allowRoll"`
	Enabled         bool            `json:"enabled"`
	Status          sourceStatusDTO `json:"status"`
}

type createSourceRequest struct {
	Name            string   `json:"name"`
	Type            string   `json:"type"`
	Path            string   `json:"path"`
	Color           string   `json:"color"`
	Tags            []string `json:"tags"`
	ExcludePatterns []string `json:"excludePatterns"`
	AllowRoll       bool     `json:"allowRoll"`
	Enabled         bool     `json:"enabled"`
}

// updateSourceRequest matches the frontend's UpdateSourceInput
// (CreateSourceInput minus "type"), plus optional id/type fields purely so
// a client that includes them can be rejected with 400 if they'd actually
// change something — the well-behaved frontend never sends either.
type updateSourceRequest struct {
	ID              string   `json:"id,omitempty"`
	Type            string   `json:"type,omitempty"`
	Name            string   `json:"name"`
	Path            string   `json:"path"`
	Color           string   `json:"color"`
	Tags            []string `json:"tags"`
	ExcludePatterns []string `json:"excludePatterns"`
	AllowRoll       bool     `json:"allowRoll"`
	Enabled         bool     `json:"enabled"`
}

type validateSourceRequest struct {
	Type            string   `json:"type"`
	Path            string   `json:"path"`
	ExcludePatterns []string `json:"excludePatterns"`
}

type matchedFileDTO struct {
	File    string `json:"file"`
	Size    int64  `json:"size"`
	ModTime string `json:"modTime"`
}

type validateSourceResponse struct {
	Valid        bool             `json:"valid"`
	MatchedFiles []matchedFileDTO `json:"matchedFiles"`
	Readable     bool             `json:"readable"`
	Message      string           `json:"message"`
}

type sourceFileDTO struct {
	File    string `json:"file"`
	Size    int64  `json:"size"`
	ModTime string `json:"modTime"`
	Active  bool   `json:"active"`
}

type lineEntryDTO struct {
	Offset int64  `json:"offset"`
	Ts     string `json:"ts"`
	Text   string `json:"text"`
	File   string `json:"file"`
}

type linesPageDTO struct {
	Entries []lineEntryDTO `json:"entries"`
	HasMore bool           `json:"hasMore"`
}

func formatModTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339Nano)
}

func nonNilStrings(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func (h *Handler) toSourceDTO(src config.Source) sourceDTO {
	status := h.manager.Status(src)
	return sourceDTO{
		ID:              src.ID,
		Name:            src.Name,
		Type:            string(src.Type),
		Path:            src.Path,
		Color:           src.Color,
		Tags:            nonNilStrings(src.Tags),
		ExcludePatterns: nonNilStrings(src.ExcludePatterns),
		AllowRoll:       src.AllowRoll,
		Enabled:         src.Enabled,
		Status: sourceStatusDTO{
			ActiveFile:       status.ActiveFile,
			MatchedFileCount: status.MatchedFileCount,
			Size:             status.Size,
			ModTime:          formatModTime(status.ModTime),
			Readable:         status.Readable,
			LastError:        status.LastError,
		},
	}
}

func toLinesPageDTO(r tail.ReadResult) linesPageDTO {
	entries := make([]lineEntryDTO, len(r.Entries))
	for i, e := range r.Entries {
		entries[i] = lineEntryDTO{Offset: e.Offset, Ts: e.Ts.UTC().Format(time.RFC3339Nano), Text: e.Text, File: e.File}
	}
	return linesPageDTO{Entries: entries, HasMore: r.HasMore}
}

// ---- handlers -----------------------------------------------------------

// GET /api/v1/sources
func (h *Handler) listSources(w http.ResponseWriter, r *http.Request) {
	cfg := h.store.Get()
	out := make([]sourceDTO, len(cfg.Sources))
	for i, src := range cfg.Sources {
		out[i] = h.toSourceDTO(src)
	}
	writeJSON(w, http.StatusOK, out)
}

// POST /api/v1/sources
func (h *Handler) createSource(w http.ResponseWriter, r *http.Request) {
	var req createSourceRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	src := config.Source{
		Name:            req.Name,
		Type:            config.SourceType(req.Type),
		Path:            req.Path,
		Color:           req.Color,
		Tags:            nonNilStrings(req.Tags),
		ExcludePatterns: nonNilStrings(req.ExcludePatterns),
		AllowRoll:       req.AllowRoll,
		Enabled:         req.Enabled,
	}
	created, err := h.store.Upsert(src)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, h.toSourceDTO(created))
}

// GET /api/v1/sources/{id}
func (h *Handler) getSource(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	src, err := h.store.GetSource(id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, h.toSourceDTO(src))
}

// PUT /api/v1/sources/{id}
func (h *Handler) updateSource(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req updateSourceRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.ID != "" && req.ID != id {
		writeError(w, http.StatusBadRequest, "id cannot be changed")
		return
	}
	if req.Type != "" {
		current, err := h.store.GetSource(id)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		if req.Type != string(current.Type) {
			writeError(w, http.StatusBadRequest, "type cannot be changed")
			return
		}
	}

	src := config.Source{
		ID:              id,
		Name:            req.Name,
		Path:            req.Path,
		Color:           req.Color,
		Tags:            nonNilStrings(req.Tags),
		ExcludePatterns: nonNilStrings(req.ExcludePatterns),
		AllowRoll:       req.AllowRoll,
		Enabled:         req.Enabled,
	}
	updated, err := h.store.Upsert(src)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, h.toSourceDTO(updated))
}

// DELETE /api/v1/sources/{id}
func (h *Handler) deleteSource(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.store.Delete(id); err != nil {
		writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// POST /api/v1/sources/validate
func (h *Handler) validateSource(w http.ResponseWriter, r *http.Request) {
	var req validateSourceRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	srcType := config.SourceType(req.Type)
	if srcType != config.SourceTypeFile && srcType != config.SourceTypeGlob {
		writeJSON(w, http.StatusOK, validateSourceResponse{MatchedFiles: []matchedFileDTO{}, Message: `type must be "file" or "glob"`})
		return
	}
	if strings.TrimSpace(req.Path) == "" {
		writeJSON(w, http.StatusOK, validateSourceResponse{MatchedFiles: []matchedFileDTO{}, Message: "path is required"})
		return
	}

	probe := config.Source{Type: srcType, Path: req.Path, ExcludePatterns: req.ExcludePatterns}
	res := logsource.Resolve(probe)

	matched := make([]matchedFileDTO, len(res.Matched))
	for i, mf := range res.Matched {
		matched[i] = matchedFileDTO{File: mf.File, Size: mf.Size, ModTime: formatModTime(mf.ModTime)}
	}
	writeJSON(w, http.StatusOK, validateSourceResponse{
		Valid:        res.Readable,
		MatchedFiles: matched,
		Readable:     res.Readable,
		Message:      res.LastError,
	})
}

// GET /api/v1/sources/{id}/lines?limit=&before=
func (h *Handler) getLines(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	src, err := h.store.GetSource(id)
	if err != nil {
		writeStoreError(w, err)
		return
	}

	limit := h.manager.DefaultBackfillLines()
	if v := r.URL.Query().Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			writeError(w, http.StatusBadRequest, "limit must be a positive integer")
			return
		}
		limit = n
	}

	var before int64
	if v := r.URL.Query().Get("before"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 0 {
			writeError(w, http.StatusBadRequest, "before must be a non-negative integer")
			return
		}
		before = n
	}

	result, err := h.manager.Backfill(src, limit, before)
	if err != nil {
		// The source exists in config but currently has no readable
		// active file (disabled, missing, permission denied, mid-rotation,
		// ...) - degrade gracefully rather than failing the whole pane.
		writeJSON(w, http.StatusOK, linesPageDTO{Entries: []lineEntryDTO{}, HasMore: false})
		return
	}
	writeJSON(w, http.StatusOK, toLinesPageDTO(result))
}

// GET /api/v1/sources/{id}/files
func (h *Handler) getFiles(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	src, err := h.store.GetSource(id)
	if err != nil {
		writeStoreError(w, err)
		return
	}

	res := logsource.Resolve(src)
	out := make([]sourceFileDTO, len(res.Matched))
	for i, mf := range res.Matched {
		out[i] = sourceFileDTO{
			File:    mf.File,
			Size:    mf.Size,
			ModTime: formatModTime(mf.ModTime),
			Active:  mf.File == res.ActiveFile,
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// GET /api/v1/sources/{id}/download?file=<path>
//
// The `file` query param is only ever trusted if it exactly matches one of
// the source's own currently-resolved files (from logsource.Resolve,
// itself derived only from the source's own configured path/glob) — this
// is the path-traversal guard: we never join user input onto a base
// directory, so there is no "../" to sanitize in the first place.
func (h *Handler) downloadSource(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	src, err := h.store.GetSource(id)
	if err != nil {
		writeStoreError(w, err)
		return
	}

	requested := r.URL.Query().Get("file")
	if requested == "" {
		writeError(w, http.StatusBadRequest, "file query parameter is required")
		return
	}

	res := logsource.Resolve(src)
	allowed := false
	for _, mf := range res.Matched {
		if mf.File == requested {
			allowed = true
			break
		}
	}
	if !allowed {
		writeError(w, http.StatusNotFound, "file is not part of this source")
		return
	}

	f, err := os.Open(requested)
	if err != nil {
		writeError(w, http.StatusNotFound, "file could not be opened")
		return
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not stat file")
		return
	}

	w.Header().Set("Content-Disposition", `attachment; filename="`+filepath.Base(requested)+`"`)
	http.ServeContent(w, r, filepath.Base(requested), info.ModTime(), f)
}

// POST /api/v1/sources/{id}/roll
func (h *Handler) rollSource(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	src, err := h.store.GetSource(id)
	if err != nil {
		writeStoreError(w, err)
		return
	}

	if err := h.manager.Roll(src); err != nil {
		switch {
		case errors.Is(err, tail.ErrRollNotAllowed):
			writeError(w, http.StatusNotFound, "roll is not enabled for this source")
		default:
			// Covers ErrRollPermissionDenied and ErrNoActiveFile: both are
			// "the file exists in config but can't be rolled right now"
			// conditions, which the frontend surfaces as a failed mutation.
			writeError(w, http.StatusConflict, err.Error())
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
