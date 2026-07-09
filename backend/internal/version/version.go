// Package version holds build-time metadata injected via -ldflags, so the
// running binary can report what was actually deployed.
package version

// These are intended to be overridden at build time via -ldflags, e.g.:
//
//	go build -ldflags "\
//	  -X github.com/lepis0/logpane/backend/internal/version.Version=1.2.3 \
//	  -X github.com/lepis0/logpane/backend/internal/version.Commit=abcdef0 \
//	  -X github.com/lepis0/logpane/backend/internal/version.BuildDate=2026-07-09T12:00:00Z"
//
// When left unset (e.g. `go run` during local development), they fall back
// to the placeholders below.
var (
	Version   = "dev"
	Commit    = "none"
	BuildDate = "unknown"
)

// Info is the JSON-serializable snapshot returned by GET /api/v1/version.
type Info struct {
	Version   string `json:"version"`
	Commit    string `json:"commit"`
	BuildDate string `json:"buildDate"`
}

// Get returns the current build metadata.
func Get() Info {
	return Info{
		Version:   Version,
		Commit:    Commit,
		BuildDate: BuildDate,
	}
}
