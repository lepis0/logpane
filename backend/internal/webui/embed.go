// Package webui embeds and serves the built frontend (the React app in
// ../../../frontend). During local backend-only development, dist/
// contains nothing but a .gitkeep placeholder (go:embed requires the
// directory to exist even when empty of real files) — the Docker build
// overwrites dist/ with the actual `npm run build` output before
// compiling the backend, so the shipped binary serves a real SPA.
//
// Handler must not panic when dist/ has no index.html (e.g. running the
// backend standalone against the placeholder): it degrades to a plain
// 404 for every path instead.
package webui

import (
	"embed"
	"io/fs"
	"net/http"
)

// "all:" is required, not just "dist": without it, go:embed silently
// excludes dotfiles (including the dist/.gitkeep placeholder present
// when no frontend build has been copied in yet), and a directory whose
// only content is excluded files fails to embed at all.
//
//go:embed all:dist
var distFS embed.FS

// Handler serves the embedded frontend build, falling back to
// index.html for any request path that doesn't match a real embedded
// file — this is what makes client-side (React Router-style) routes work
// on a hard refresh or direct link.
func Handler() http.Handler {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		return notEmbeddedHandler()
	}

	hasIndex := false
	if _, err := fs.Stat(sub, "index.html"); err == nil {
		hasIndex = true
	}
	if !hasIndex {
		return notEmbeddedHandler()
	}

	fileServer := http.FileServerFS(sub)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path == "" || path == "/" {
			fileServer.ServeHTTP(w, r)
			return
		}
		// Strip the leading slash for fs.Stat, which (like all fs.FS
		// paths) expects a rooted-at-root, slash-less-prefix path.
		clean := path[1:]
		if _, err := fs.Stat(sub, clean); err != nil {
			// No exact static asset at this path (e.g. a client-side
			// route like /sources/abc-123): serve index.html instead and
			// let the SPA's own router take over.
			r2 := r.Clone(r.Context())
			r2.URL.Path = "/index.html"
			fileServer.ServeHTTP(w, r2)
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}

func notEmbeddedHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "frontend not embedded in this build", http.StatusNotFound)
	})
}
