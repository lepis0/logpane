package tail

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeTempFile(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "test.log")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	return path
}

func texts(entries []Entry) []string {
	out := make([]string, len(entries))
	for i, e := range entries {
		out[i] = e.Text
	}
	return out
}

func offsets(entries []Entry) []int64 {
	out := make([]int64, len(entries))
	for i, e := range entries {
		out[i] = e.Offset
	}
	return out
}

func TestReadLastLinesBasicTrailingNewline(t *testing.T) {
	path := writeTempFile(t, "line1\nline2\nline3\nline4\nline5\n")

	res, err := ReadLastLines(path, 3, 0)
	if err != nil {
		t.Fatalf("ReadLastLines: %v", err)
	}
	if got, want := texts(res.Entries), []string{"line3", "line4", "line5"}; !equalStrings(got, want) {
		t.Errorf("texts = %v, want %v", got, want)
	}
	if !res.HasMore {
		t.Errorf("HasMore = false, want true")
	}
	if res.Capped {
		t.Errorf("Capped = true, want false")
	}
	// line3 starts right after "line1\nline2\n" = 12 bytes.
	if res.Entries[0].Offset != 12 {
		t.Errorf("first offset = %d, want 12", res.Entries[0].Offset)
	}
	for _, e := range res.Entries {
		if e.File != path {
			t.Errorf("entry.File = %q, want %q", e.File, path)
		}
	}
}

func TestReadLastLinesNoTrailingNewline(t *testing.T) {
	// Edge case: the file's final line is not newline-terminated.
	path := writeTempFile(t, "aaa\nbbb\nccc")

	cases := []struct {
		n    int
		want []string
	}{
		{1, []string{"ccc"}},
		{2, []string{"bbb", "ccc"}},
		{3, []string{"aaa", "bbb", "ccc"}},
	}
	for _, c := range cases {
		res, err := ReadLastLines(path, c.n, 0)
		if err != nil {
			t.Fatalf("ReadLastLines(n=%d): %v", c.n, err)
		}
		if got := texts(res.Entries); !equalStrings(got, c.want) {
			t.Errorf("n=%d: texts = %v, want %v", c.n, got, c.want)
		}
	}

	// n=3 consumes the whole file, so there's nothing more before it.
	res, err := ReadLastLines(path, 3, 0)
	if err != nil {
		t.Fatalf("ReadLastLines: %v", err)
	}
	if res.HasMore {
		t.Errorf("HasMore = true, want false (whole file returned)")
	}
}

func TestReadLastLinesNLargerThanTotalLines(t *testing.T) {
	path := writeTempFile(t, "one\ntwo\nthree\n")

	res, err := ReadLastLines(path, 100, 0)
	if err != nil {
		t.Fatalf("ReadLastLines: %v", err)
	}
	if got, want := texts(res.Entries), []string{"one", "two", "three"}; !equalStrings(got, want) {
		t.Errorf("texts = %v, want %v", got, want)
	}
	if res.HasMore {
		t.Errorf("HasMore = true, want false")
	}
	if res.Capped {
		t.Errorf("Capped = true, want false")
	}
	if res.Entries[0].Offset != 0 {
		t.Errorf("first offset = %d, want 0", res.Entries[0].Offset)
	}
}

func TestReadLastLinesFileShorterThanOneChunk(t *testing.T) {
	path := writeTempFile(t, "short\nfile\n")
	if info, _ := os.Stat(path); info.Size() >= readChunkSize {
		t.Fatalf("test file unexpectedly >= one chunk")
	}

	res, err := ReadLastLines(path, 2, 0)
	if err != nil {
		t.Fatalf("ReadLastLines: %v", err)
	}
	if got, want := texts(res.Entries), []string{"short", "file"}; !equalStrings(got, want) {
		t.Errorf("texts = %v, want %v", got, want)
	}
	if res.HasMore {
		t.Errorf("HasMore = true, want false")
	}
}

func TestReadLastLinesEmptyFile(t *testing.T) {
	path := writeTempFile(t, "")

	res, err := ReadLastLines(path, 5, 0)
	if err != nil {
		t.Fatalf("ReadLastLines: %v", err)
	}
	if len(res.Entries) != 0 {
		t.Errorf("Entries = %v, want empty", res.Entries)
	}
	if res.HasMore {
		t.Errorf("HasMore = true, want false")
	}
}

func TestReadLastLinesPaginationNoGapsOrDuplicates(t *testing.T) {
	var lines []string
	for i := 1; i <= 9; i++ {
		lines = append(lines, fmt.Sprintf("line%d", i))
	}
	content := strings.Join(lines, "\n") + "\n"
	path := writeTempFile(t, content)

	// First page: last 3 lines.
	page1, err := ReadLastLines(path, 3, 0)
	if err != nil {
		t.Fatalf("page1: %v", err)
	}
	if got, want := texts(page1.Entries), []string{"line7", "line8", "line9"}; !equalStrings(got, want) {
		t.Fatalf("page1 texts = %v, want %v", got, want)
	}
	if !page1.HasMore {
		t.Fatalf("page1.HasMore = false, want true")
	}

	// Second page: the 3 lines immediately before page1's first entry.
	page2, err := ReadLastLines(path, 3, page1.Entries[0].Offset)
	if err != nil {
		t.Fatalf("page2: %v", err)
	}
	if got, want := texts(page2.Entries), []string{"line4", "line5", "line6"}; !equalStrings(got, want) {
		t.Fatalf("page2 texts = %v, want %v", got, want)
	}
	if !page2.HasMore {
		t.Fatalf("page2.HasMore = false, want true")
	}

	// Third page: remaining lines.
	page3, err := ReadLastLines(path, 3, page2.Entries[0].Offset)
	if err != nil {
		t.Fatalf("page3: %v", err)
	}
	if got, want := texts(page3.Entries), []string{"line1", "line2", "line3"}; !equalStrings(got, want) {
		t.Fatalf("page3 texts = %v, want %v", got, want)
	}
	if page3.HasMore {
		t.Fatalf("page3.HasMore = true, want false")
	}
	if page3.Entries[0].Offset != 0 {
		t.Fatalf("page3 first offset = %d, want 0", page3.Entries[0].Offset)
	}

	// Concatenating all three pages in chronological order must reproduce
	// the original file exactly, with strictly increasing, non-overlapping
	// offsets — i.e. no gap and no duplication across page boundaries.
	all := append(append(page3.Entries, page2.Entries...), page1.Entries...)
	if len(all) != 9 {
		t.Fatalf("total entries across pages = %d, want 9", len(all))
	}
	offs := offsets(all)
	for i := 1; i < len(offs); i++ {
		if offs[i] <= offs[i-1] {
			t.Fatalf("offsets not strictly increasing across pages: %v", offs)
		}
	}
	for i, e := range all {
		if e.Text != fmt.Sprintf("line%d", i+1) {
			t.Fatalf("reassembled entry %d = %q, want %q", i, e.Text, fmt.Sprintf("line%d", i+1))
		}
	}
}

func TestReadLastLinesScanCapOnPathologicalSingleLine(t *testing.T) {
	// A single "line" bigger than the scan cap, with no newlines at all,
	// must not be read into memory in full, must not crash, and must
	// report Capped=true rather than falsely claiming BOF was reached.
	huge := strings.Repeat("x", maxScanBack+readChunkSize)
	path := writeTempFile(t, huge)

	res, err := ReadLastLines(path, 5, 0)
	if err != nil {
		t.Fatalf("ReadLastLines: %v", err)
	}
	if !res.Capped {
		t.Errorf("Capped = false, want true")
	}
	if !res.HasMore {
		t.Errorf("HasMore = false, want true")
	}
	if len(res.Entries) != 0 {
		t.Errorf("Entries = %d, want 0 (the only candidate line was an unreliable capped fragment)", len(res.Entries))
	}
}

func TestReadLastLinesScanCapWithTrailingShortLines(t *testing.T) {
	// A huge unbroken prefix, followed by a few normal short lines at the
	// end. The short lines (fully bounded by real newlines/EOF within the
	// scan window) must still come back correctly even though the scan hit
	// its cap before reaching the start of the file.
	huge := strings.Repeat("x", maxScanBack+readChunkSize)
	content := huge + "\ntailA\ntailB\n"
	path := writeTempFile(t, content)

	res, err := ReadLastLines(path, 2, 0)
	if err != nil {
		t.Fatalf("ReadLastLines: %v", err)
	}
	if got, want := texts(res.Entries), []string{"tailA", "tailB"}; !equalStrings(got, want) {
		t.Errorf("texts = %v, want %v", got, want)
	}
	if !res.HasMore {
		t.Errorf("HasMore = false, want true")
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
