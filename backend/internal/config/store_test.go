package config

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError + 100}))
}

func TestLoadInitializesDefaultOnMissingFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nested", "logpane.yaml")

	s, err := NewStore(path, discardLogger())
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer s.Close()

	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected config file to be written, stat failed: %v", err)
	}

	cfg := s.Get()
	if cfg.SchemaVersion != 1 {
		t.Errorf("SchemaVersion = %d, want 1", cfg.SchemaVersion)
	}
	if len(cfg.Sources) != 0 {
		t.Errorf("Sources = %v, want empty", cfg.Sources)
	}
	if cfg.Settings.MaxInitialLines != 1000 {
		t.Errorf("MaxInitialLines = %d, want 1000", cfg.Settings.MaxInitialLines)
	}
	if cfg.Settings.CoalesceWindowMs != 50 {
		t.Errorf("CoalesceWindowMs = %d, want 50", cfg.Settings.CoalesceWindowMs)
	}
}

func TestSaveReloadRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "logpane.yaml")

	s, err := NewStore(path, discardLogger())
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer s.Close()

	created, err := s.Upsert(Source{
		Name:            "System Log",
		Type:            SourceTypeFile,
		Path:            "/logs/syslog/syslog.log",
		Color:           "#38bdf8",
		Tags:            []string{"system"},
		ExcludePatterns: []string{},
		AllowRoll:       false,
		Enabled:         true,
	})
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	if created.ID != "system-log" {
		t.Fatalf("created.ID = %q, want %q", created.ID, "system-log")
	}

	// Reload into a fresh store instance pointed at the same file and make
	// sure everything survived the round trip byte-for-byte semantically.
	s2, err := NewStore(path, discardLogger())
	if err != nil {
		t.Fatalf("second NewStore: %v", err)
	}
	defer s2.Close()

	cfg := s2.Get()
	if len(cfg.Sources) != 1 {
		t.Fatalf("Sources = %v, want 1 entry", cfg.Sources)
	}
	got := cfg.Sources[0]
	if got.ID != "system-log" || got.Name != "System Log" || got.Path != "/logs/syslog/syslog.log" {
		t.Errorf("reloaded source = %+v, want id/name/path to match", got)
	}
	if got.Type != SourceTypeFile {
		t.Errorf("reloaded type = %q, want file", got.Type)
	}
	if len(got.Tags) != 1 || got.Tags[0] != "system" {
		t.Errorf("reloaded tags = %v, want [system]", got.Tags)
	}
}

func TestAtomicWriteRepeatedSavesDoNotCorrupt(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "logpane.yaml")

	s, err := NewStore(path, discardLogger())
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer s.Close()

	created, err := s.Upsert(Source{Name: "Source", Type: SourceTypeFile, Path: "/logs/a.log", Enabled: true})
	if err != nil {
		t.Fatalf("initial Upsert: %v", err)
	}
	for i := 0; i < 25; i++ {
		if _, err := s.Upsert(Source{
			ID: created.ID, Name: "Source", Path: fmt.Sprintf("/logs/a-%d.log", i), Enabled: true,
		}); err != nil {
			t.Fatalf("Upsert iteration %d: %v", i, err)
		}
	}

	// No stray .tmp files should be left behind in the directory.
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	for _, e := range entries {
		if filepath.Ext(e.Name()) == ".tmp" {
			t.Errorf("stray temp file left behind: %s", e.Name())
		}
	}

	// The file on disk must still parse cleanly.
	s2, err := NewStore(path, discardLogger())
	if err != nil {
		t.Fatalf("reload after repeated saves: %v", err)
	}
	defer s2.Close()
	if len(s2.Get().Sources) != 1 {
		t.Fatalf("expected exactly 1 source after repeated upserts of the same id, got %d", len(s2.Get().Sources))
	}
}

func TestUpsertIDCollisionSuffixing(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "logpane.yaml")

	s, err := NewStore(path, discardLogger())
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer s.Close()

	names := []string{"App Log", "App Log", "App Log"}
	wantIDs := []string{"app-log", "app-log-2", "app-log-3"}

	for i, name := range names {
		created, err := s.Upsert(Source{Name: name, Type: SourceTypeFile, Path: "/logs/x.log", Enabled: true})
		if err != nil {
			t.Fatalf("Upsert %d: %v", i, err)
		}
		if created.ID != wantIDs[i] {
			t.Errorf("Upsert %d: ID = %q, want %q", i, created.ID, wantIDs[i])
		}
	}
}

func TestUpsertRejectsTypeChange(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "logpane.yaml")
	s, err := NewStore(path, discardLogger())
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer s.Close()

	created, err := s.Upsert(Source{Name: "Glob Log", Type: SourceTypeGlob, Path: "/logs/*.log", Enabled: true})
	if err != nil {
		t.Fatalf("Upsert create: %v", err)
	}

	_, err = s.Upsert(Source{ID: created.ID, Type: SourceTypeFile, Name: "Glob Log", Path: "/logs/*.log", Enabled: true})
	if !errors.Is(err, ErrImmutable) {
		t.Fatalf("Upsert type change: err = %v, want ErrImmutable", err)
	}
}

func TestUpsertUpdateUnknownIDReturnsNotFound(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "logpane.yaml")
	s, err := NewStore(path, discardLogger())
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer s.Close()

	_, err = s.Upsert(Source{ID: "does-not-exist", Name: "x", Path: "/logs/x.log"})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestDeleteRemovesSourceAndNotifies(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "logpane.yaml")
	s, err := NewStore(path, discardLogger())
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer s.Close()

	created, err := s.Upsert(Source{Name: "Temp", Type: SourceTypeFile, Path: "/logs/x.log"})
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	var mu sync.Mutex
	var notified []Config
	s.Subscribe(func(c Config) {
		mu.Lock()
		notified = append(notified, c)
		mu.Unlock()
	})

	if err := s.Delete(created.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if err := s.Delete(created.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second Delete err = %v, want ErrNotFound", err)
	}

	mu.Lock()
	n := len(notified)
	mu.Unlock()
	if n != 1 {
		t.Fatalf("subscriber notified %d times, want 1", n)
	}
	if len(s.Get().Sources) != 0 {
		t.Fatalf("expected no sources after delete, got %v", s.Get().Sources)
	}
}

func TestLoadRejectsInvalidSlugID(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "logpane.yaml")
	if err := os.WriteFile(path, []byte("schemaVersion: 1\nsources:\n  - id: \"Not A Slug!\"\n    name: bad\n    type: file\n    path: /x.log\n"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	if _, err := NewStore(path, discardLogger()); !errors.Is(err, ErrInvalid) {
		t.Fatalf("NewStore err = %v, want ErrInvalid", err)
	}
}

func TestWatchReloadsOnExternalEdit(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "logpane.yaml")

	s, err := NewStore(path, discardLogger())
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer s.Close()

	notifyCh := make(chan Config, 4)
	s.Subscribe(func(c Config) { notifyCh <- c })

	const doc = `schemaVersion: 1
settings:
  maxInitialLines: 1000
  coalesceWindowMs: 50
sources:
  - id: external
    name: External
    type: file
    path: /logs/external.log
    color: ""
    tags: []
    excludePatterns: []
    allowRoll: false
    enabled: true
`
	// Simulate an editor that writes a temp file and renames over the
	// original, which is why the store watches the directory rather than
	// the file handle directly.
	tmp := path + ".editor-tmp"
	if err := os.WriteFile(tmp, []byte(doc), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		t.Fatalf("Rename: %v", err)
	}

	select {
	case cfg := <-notifyCh:
		if len(cfg.Sources) != 1 || cfg.Sources[0].ID != "external" {
			t.Fatalf("reloaded config = %+v, want one source with id external", cfg)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for watch-triggered reload notification")
	}
}
