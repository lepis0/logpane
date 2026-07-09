// Package logsource resolves a configured source (a single file, or a glob
// pattern that may match many files) to concrete files on disk right now.
// Resolution never errors for "expected" misconfiguration (missing file,
// permission denied, no glob matches) — callers get a structured result
// they can surface in the UI instead.
package logsource

import (
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/lepis0/logpane/backend/internal/config"
)

// MatchedFile describes one file on disk that currently matches a source's
// configuration.
type MatchedFile struct {
	File    string
	Size    int64
	ModTime time.Time
}

// Resolution is the outcome of resolving a config.Source against the
// filesystem at a single point in time.
type Resolution struct {
	// ActiveFile is the file that should be tailed: for type=file, Path
	// itself (if readable); for type=glob, the most recently modified
	// match. Empty when nothing is currently resolvable.
	ActiveFile string
	// Matched lists every file currently matching the source's
	// configuration (with ExcludePatterns already applied), sorted by
	// path. For type=file this has at most one entry.
	Matched []MatchedFile
	// Readable is true when ActiveFile is set and was confirmed openable
	// for reading.
	Readable bool
	// LastError explains why Readable is false / nothing matched. Empty
	// when Readable is true.
	LastError string
}

// Resolve inspects disk state for src right now. It performs no caching; a
// caller that needs to react to changes (new glob matches, rotation, a file
// reappearing) calls Resolve again — logsource has no long-lived state.
func Resolve(src config.Source) Resolution {
	if src.Type == config.SourceTypeGlob {
		return resolveGlob(src)
	}
	return resolveFile(src.Path)
}

func resolveFile(path string) Resolution {
	info, err := os.Stat(path)
	if err != nil {
		return Resolution{LastError: err.Error()}
	}
	if !info.Mode().IsRegular() {
		return Resolution{LastError: path + " is not a regular file"}
	}
	// os.Stat only requires search permission on parent directories; open
	// it to confirm the file itself is actually readable by this process.
	f, err := os.Open(path)
	if err != nil {
		return Resolution{LastError: err.Error()}
	}
	_ = f.Close()

	return Resolution{
		ActiveFile: path,
		Matched: []MatchedFile{{
			File:    path,
			Size:    info.Size(),
			ModTime: info.ModTime(),
		}},
		Readable: true,
	}
}

func resolveGlob(src config.Source) Resolution {
	matches, err := filepath.Glob(src.Path)
	if err != nil {
		return Resolution{LastError: "invalid glob pattern: " + err.Error()}
	}

	files := make([]MatchedFile, 0, len(matches))
	for _, m := range matches {
		if isExcluded(m, src.ExcludePatterns) {
			continue
		}
		info, err := os.Stat(m)
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		files = append(files, MatchedFile{File: m, Size: info.Size(), ModTime: info.ModTime()})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].File < files[j].File })

	if len(files) == 0 {
		return Resolution{LastError: "no files matched pattern " + src.Path}
	}

	active := files[0]
	for _, f := range files[1:] {
		if f.ModTime.After(active.ModTime) {
			active = f
		}
	}

	return Resolution{
		ActiveFile: active.File,
		Matched:    files,
		Readable:   true,
	}
}

// isExcluded reports whether file's base name matches any of patterns
// (glob syntax, per path/filepath.Match).
func isExcluded(file string, patterns []string) bool {
	base := filepath.Base(file)
	for _, p := range patterns {
		if ok, err := filepath.Match(p, base); err == nil && ok {
			return true
		}
	}
	return false
}
