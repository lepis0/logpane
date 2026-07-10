package logsource

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func names(entries []DirEntry) []string {
	out := make([]string, len(entries))
	for i, e := range entries {
		out[i] = e.Name
	}
	return out
}

func TestListDirOrdersDirsBeforeFilesThenAlphabetically(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"b.log", "a.log", "Z.log"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o644); err != nil {
			t.Fatalf("WriteFile: %v", err)
		}
	}
	for _, name := range []string{"zsub", "asub"} {
		if err := os.Mkdir(filepath.Join(dir, name), 0o755); err != nil {
			t.Fatalf("Mkdir: %v", err)
		}
	}

	listing := ListDir(dir)
	if !listing.Readable {
		t.Fatalf("Readable = false, LastError = %q", listing.LastError)
	}
	if got, want := names(listing.Entries), []string{"asub", "zsub", "a.log", "b.log", "Z.log"}; !equalStrings(got, want) {
		t.Errorf("names = %v, want %v", got, want)
	}
	for _, e := range listing.Entries {
		if e.Name == "asub" || e.Name == "zsub" {
			if e.Type != "dir" {
				t.Errorf("%s: Type = %q, want dir", e.Name, e.Type)
			}
		} else if e.Type != "file" {
			t.Errorf("%s: Type = %q, want file", e.Name, e.Type)
		}
	}
}

func TestListDirParentIsEmptyAtRoot(t *testing.T) {
	listing := ListDir("/")
	if listing.Parent != "" {
		t.Errorf("Parent = %q, want empty at filesystem root", listing.Parent)
	}
}

func TestListDirParentIsSetForSubdirectory(t *testing.T) {
	dir := t.TempDir()
	sub := filepath.Join(dir, "child")
	if err := os.Mkdir(sub, 0o755); err != nil {
		t.Fatalf("Mkdir: %v", err)
	}
	listing := ListDir(sub)
	if listing.Parent != dir {
		t.Errorf("Parent = %q, want %q", listing.Parent, dir)
	}
}

func TestListDirMissingPathReturnsUnreadable(t *testing.T) {
	listing := ListDir(filepath.Join(t.TempDir(), "does-not-exist"))
	if listing.Readable {
		t.Errorf("Readable = true, want false")
	}
	if listing.LastError == "" {
		t.Errorf("LastError is empty, want an explanation")
	}
	if len(listing.Entries) != 0 {
		t.Errorf("Entries = %v, want empty", listing.Entries)
	}
}

func TestListDirOnRegularFileReturnsUnreadable(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.log")
	if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	listing := ListDir(path)
	if listing.Readable {
		t.Errorf("Readable = true, want false")
	}
}

func TestListDirEmptyPathDefaultsToRoot(t *testing.T) {
	listing := ListDir("")
	if listing.Path != string(filepath.Separator) && listing.Path != "/" {
		t.Errorf("Path = %q, want filesystem root", listing.Path)
	}
}

func TestListDirPermissionDenied(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX chmod permission bits are not honored for the owning account on Windows/NTFS")
	}
	dir := t.TempDir()
	sub := filepath.Join(dir, "locked")
	if err := os.Mkdir(sub, 0o755); err != nil {
		t.Fatalf("Mkdir: %v", err)
	}
	if err := os.Chmod(sub, 0o000); err != nil {
		t.Fatalf("Chmod: %v", err)
	}
	t.Cleanup(func() { _ = os.Chmod(sub, 0o755) })

	listing := ListDir(sub)
	if listing.Readable {
		t.Errorf("Readable = true, want false")
	}
	if listing.LastError == "" {
		t.Errorf("LastError is empty, want a permission error")
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
