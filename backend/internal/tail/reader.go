package tail

import (
	"bytes"
	"io"
	"os"
	"time"
)

const (
	// readChunkSize is how much we read per backward seek step.
	readChunkSize = 64 * 1024
	// maxScanBack is a hard safety valve on total bytes scanned backward
	// in a single ReadLastLines call, so a pathological file containing
	// one enormous "line" (or a very large `n`) can't force us to read an
	// unbounded amount of data into memory.
	maxScanBack = 5 * 1024 * 1024
)

// Entry is a single log line as read by the backend.
//
// Offset is the byte offset in File where this line's text begins. It
// doubles as a pagination cursor (pass it back as `beforeOffset` to page
// further into the file's history) and, in the WS layer, as a per-source
// monotonically increasing sequence number.
//
// Ts is the wall-clock time the backend read the line — deliberately not
// parsed from the log content itself, to keep it simple and deterministic
// regardless of what log format a given source uses.
type Entry struct {
	Offset int64
	Text   string
	File   string
	Ts     time.Time
}

// ReadResult is the outcome of a single ReadLastLines call.
type ReadResult struct {
	Entries []Entry
	// HasMore is true if earlier lines exist in the file beyond what was
	// returned — equivalently, the first returned entry's offset is > 0
	// (or, when zero entries were returned, the scan did not reach byte
	// 0 of the file).
	HasMore bool
	// Capped is true if the scan-back safety valve (maxScanBack) was
	// reached before either satisfying the requested line count or
	// reaching the start of the file. This is distinct from HasMore: it
	// tells the caller *why* fewer lines than requested might have come
	// back — a genuinely short file (HasMore=false) versus a scan that
	// gave up early on a pathologically large chunk of unbroken data.
	Capped bool
}

// ReadLastLines reads up to n lines immediately before beforeOffset from
// path, without ever loading more than a bounded window of the file into
// memory. If beforeOffset <= 0 (unset), it reads the last n lines up to
// EOF instead.
//
// Algorithm: seek backward from the start point in fixed-size chunks,
// counting '\n' bytes as they're read, until enough newlines have been
// found to delimit n complete lines, or the start of the file is reached,
// or maxScanBack total bytes have been scanned — whichever comes first.
// The scanned window is then split into lines and trimmed to exactly the
// last n (chunk granularity means we sometimes scan a bit further than
// strictly necessary).
func ReadLastLines(path string, n int, beforeOffset int64) (ReadResult, error) {
	f, err := os.Open(path)
	if err != nil {
		return ReadResult{}, err
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return ReadResult{}, err
	}
	fileSize := info.Size()

	end := beforeOffset
	if end <= 0 || end > fileSize {
		end = fileSize
	}
	if end <= 0 || n <= 0 {
		return ReadResult{HasMore: end > 0}, nil
	}
	readAt := time.Now()

	// hasTrailingNewlineAtEnd tells us whether the byte immediately before
	// `end` is itself a '\n'. This is true for an EOF that ends with a
	// trailing newline, and always true for a pagination boundary (since
	// `end` there is always some earlier line's start offset — i.e.
	// immediately after a '\n'). When true, scanning needs to find one
	// *extra* newline, because the first one encountered (scanning
	// backward) is that trailing terminator rather than a line-start
	// delimiter; the terminator produces an empty trailing split segment
	// that gets discarded below. When false (an EOF with an unterminated
	// final line), only n newlines are needed to delimit n lines.
	var lastByte [1]byte
	if _, err := f.ReadAt(lastByte[:], end-1); err != nil && err != io.EOF {
		return ReadResult{}, err
	}
	hasTrailingNewlineAtEnd := lastByte[0] == '\n'
	threshold := n
	if hasTrailingNewlineAtEnd {
		threshold = n + 1
	}

	pos := end
	var chunks [][]byte
	var newlineCount int
	var totalScanned int64

	for newlineCount < threshold && pos > 0 && totalScanned < maxScanBack {
		readLen := readChunkSize
		if int64(readLen) > pos {
			readLen = int(pos)
		}
		readStart := pos - int64(readLen)

		buf := make([]byte, readLen)
		got, rerr := f.ReadAt(buf, readStart)
		if rerr != nil && rerr != io.EOF {
			return ReadResult{}, rerr
		}
		buf = buf[:got]
		if got < readLen {
			// The file shrank under us (e.g. concurrent roll/truncate).
			// Treat whatever we actually got as the effective start of
			// scannable data rather than risking an inconsistent offset
			// map; this is not the "capped" case, since nothing was
			// deliberately left unscanned.
			chunks = append(chunks, buf)
			pos = readStart + int64(got)
			totalScanned += int64(got)
			break
		}

		newlineCount += bytes.Count(buf, []byte{'\n'})
		chunks = append(chunks, buf)
		totalScanned += int64(readLen)
		pos = readStart
	}

	// pos is now the absolute offset of the start of the scanned region.
	regionStart := pos
	capped := newlineCount < threshold && regionStart > 0

	// Reassemble chunks (read back-to-front) into one contiguous buffer
	// covering [regionStart, end).
	full := make([]byte, 0, totalScanned)
	for i := len(chunks) - 1; i >= 0; i-- {
		full = append(full, chunks[i]...)
	}

	entries, firstOffset := extractLines(full, regionStart, hasTrailingNewlineAtEnd, capped, n, path, readAt)
	if len(entries) == 0 {
		firstOffset = regionStart
	}

	return ReadResult{
		Entries: entries,
		HasMore: firstOffset > 0,
		Capped:  capped,
	}, nil
}

// extractLines splits `full` (the bytes covering [regionStart, regionStart
// + len(full)) of the file) into lines, dropping segments that aren't
// reliable/real, and returns at most the last n of them.
func extractLines(full []byte, regionStart int64, hasTrailingNewlineAtEnd, capped bool, n int, path string, readAt time.Time) ([]Entry, int64) {
	type seg struct {
		offset int64
		text   string
	}

	segs := make([]seg, 0, 16)
	start := 0
	segStart := regionStart
	for i, b := range full {
		if b != '\n' {
			continue
		}
		segs = append(segs, seg{offset: segStart, text: string(full[start:i])})
		start = i + 1
		segStart = regionStart + int64(start)
	}
	segs = append(segs, seg{offset: segStart, text: string(full[start:])})

	// The final segment is an empty artifact of the trailing terminator
	// newline, not a real line — drop it.
	if hasTrailingNewlineAtEnd && len(segs) > 0 {
		segs = segs[:len(segs)-1]
	}
	// When we stopped scanning because we hit the safety cap (rather than
	// finding a clean line boundary or reaching byte 0), the leading
	// fragment's true start is unknown — it may be a truncated tail of a
	// much longer line we chose not to read in full. Discard it.
	if capped && len(segs) > 0 {
		segs = segs[1:]
	}
	// Chunk granularity means we may have scanned further than strictly
	// necessary; keep only the most recent n. Anything older stays on
	// disk for a future "before" pagination call.
	if len(segs) > n {
		segs = segs[len(segs)-n:]
	}

	entries := make([]Entry, 0, len(segs))
	for _, sg := range segs {
		entries = append(entries, Entry{Offset: sg.offset, Text: sg.text, File: path, Ts: readAt})
	}
	if len(entries) == 0 {
		return entries, regionStart
	}
	return entries, entries[0].Offset
}
