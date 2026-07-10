package logsource

import (
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// DirEntry describes one child of a directory listed by ListDir.
type DirEntry struct {
	Name    string
	Path    string
	Type    string // "dir" | "file" | "other"
	Size    int64
	ModTime time.Time
}

// DirListing is the outcome of listing a directory's contents right now, for
// the source-path file browser. Like Resolution, it never surfaces an
// "expected" filesystem condition (missing directory, permission denied, not
// a directory) as a Go error — callers get a structured result instead.
type DirListing struct {
	Path string
	// Parent is the listing's parent directory, or "" when Path is the
	// filesystem root.
	Parent   string
	Entries  []DirEntry
	Readable bool
	// LastError explains why Readable is false. Empty when Readable is true.
	LastError string
}

// ListDir lists the contents of path (defaulting to the filesystem root when
// path is empty). It performs no caching; callers that need to react to
// changes call ListDir again.
func ListDir(path string) DirListing {
	if strings.TrimSpace(path) == "" {
		path = "/"
	}
	path = filepath.Clean(path)

	parent := filepath.Dir(path)
	if parent == path {
		// path is already a filesystem root (Dir of a root is a fixed point
		// on every OS: "/" on Unix, "\" or "C:\" on Windows).
		parent = ""
	}

	dirEntries, err := os.ReadDir(path)
	if err != nil {
		return DirListing{Path: path, Parent: parent, LastError: err.Error()}
	}

	entries := make([]DirEntry, 0, len(dirEntries))
	for _, de := range dirEntries {
		entries = append(entries, toDirEntry(path, de))
	}
	sort.Slice(entries, func(i, j int) bool {
		if (entries[i].Type == "dir") != (entries[j].Type == "dir") {
			return entries[i].Type == "dir"
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})

	return DirListing{Path: path, Parent: parent, Entries: entries, Readable: true}
}

func toDirEntry(dir string, de fs.DirEntry) DirEntry {
	full := filepath.Join(dir, de.Name())
	entry := DirEntry{Name: de.Name(), Path: full}

	info, err := de.Info()
	if err != nil {
		entry.Type = "other"
		return entry
	}

	mode := info.Mode()
	if mode&fs.ModeSymlink != 0 {
		// de.Info() is Lstat-based and never follows symlinks; resolve the
		// link target to report what it actually points at.
		target, statErr := os.Stat(full)
		if statErr != nil {
			entry.Type = "other"
			return entry
		}
		info = target
		mode = info.Mode()
	}

	switch {
	case mode.IsDir():
		entry.Type = "dir"
	case mode.IsRegular():
		entry.Type = "file"
		entry.Size = info.Size()
	default:
		entry.Type = "other"
	}
	entry.ModTime = info.ModTime()
	return entry
}
