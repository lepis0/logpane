// Package config defines Logpane's on-disk YAML configuration schema and an
// in-memory store that loads, validates, persists, and hot-reloads it.
package config

// SourceType enumerates the kinds of log source Logpane understands.
type SourceType string

const (
	// SourceTypeFile is a single, concrete file path.
	SourceTypeFile SourceType = "file"
	// SourceTypeGlob is a glob pattern that may match multiple files; the
	// most recently modified match is treated as the "active" file to tail.
	SourceTypeGlob SourceType = "glob"
)

// Settings holds server-wide tunables.
type Settings struct {
	// MaxInitialLines is the default number of lines to back-fill when a
	// client first opens a source (also the default for the `limit` query
	// param on GET /api/v1/sources/{id}/lines).
	MaxInitialLines int `yaml:"maxInitialLines" json:"maxInitialLines"`
	// CoalesceWindowMs is the WebSocket line-batching window, in milliseconds.
	CoalesceWindowMs int `yaml:"coalesceWindowMs" json:"coalesceWindowMs"`
}

// DefaultSettings returns the settings applied to a freshly initialized
// config, and used to backfill any zero-valued fields found in a config
// loaded from disk (e.g. after a hand-edit that omitted them).
func DefaultSettings() Settings {
	return Settings{
		MaxInitialLines:  1000,
		CoalesceWindowMs: 50,
	}
}

// Source describes one configured log source: a file or a glob of files on
// disk. The yaml and json tags intentionally match field-for-field so this
// same struct can be embedded directly in API request/response bodies.
type Source struct {
	// ID is a URL-safe slug, unique among sources, matching ^[a-z0-9-]+$.
	// It is server-generated on creation (slugified from Name, with -2/-3
	// suffixing on collision) and immutable thereafter.
	ID string `yaml:"id" json:"id"`
	// Name is the human-readable display name shown in the UI.
	Name string `yaml:"name" json:"name"`
	// Type is "file" or "glob" and is immutable after creation.
	Type SourceType `yaml:"type" json:"type"`
	// Path is a single file path (Type == file) or a glob pattern
	// (Type == glob), e.g. "/logs/docker/*.log".
	Path string `yaml:"path" json:"path"`
	// Color is a UI hint (hex string) for the source's tab/badge color.
	Color string `yaml:"color" json:"color"`
	// Tags are free-form labels for grouping/filtering in the UI.
	Tags []string `yaml:"tags" json:"tags"`
	// ExcludePatterns are glob patterns (matched against the base filename)
	// to exclude from a glob source's matches. Only meaningful when
	// Type == glob.
	ExcludePatterns []string `yaml:"excludePatterns" json:"excludePatterns"`
	// AllowRoll gates whether POST .../roll may truncate the active file.
	AllowRoll bool `yaml:"allowRoll" json:"allowRoll"`
	// Enabled controls whether the source is tailed at all.
	Enabled bool `yaml:"enabled" json:"enabled"`
}

// Config is the full on-disk configuration document.
type Config struct {
	SchemaVersion int      `yaml:"schemaVersion" json:"schemaVersion"`
	Settings      Settings `yaml:"settings" json:"settings"`
	Sources       []Source `yaml:"sources" json:"sources"`
}

// currentSchemaVersion is written into freshly-initialized configs.
const currentSchemaVersion = 1

// DefaultConfig returns a minimal, valid, self-initializing configuration:
// schema version 1, default settings, and no sources.
func DefaultConfig() Config {
	return Config{
		SchemaVersion: currentSchemaVersion,
		Settings:      DefaultSettings(),
		Sources:       []Source{},
	}
}

// Clone returns a deep copy of the config so callers can't mutate the
// store's internal state through slices/maps shared by reference.
func (c Config) Clone() Config {
	out := c
	out.Sources = make([]Source, len(c.Sources))
	for i, src := range c.Sources {
		out.Sources[i] = src.Clone()
	}
	return out
}

// Clone returns a deep copy of the source (its slice fields are copied, not
// shared).
func (s Source) Clone() Source {
	out := s
	if s.Tags != nil {
		out.Tags = append([]string(nil), s.Tags...)
	}
	if s.ExcludePatterns != nil {
		out.ExcludePatterns = append([]string(nil), s.ExcludePatterns...)
	}
	return out
}
