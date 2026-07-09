package tail

import (
	"io"
	"log/slog"
	"os"
	"time"

	nxadmtail "github.com/nxadm/tail"
)

// NotificationType enumerates the discrete, non-line-data events a Tailer
// can report about the file it's following.
type NotificationType string

const (
	NotificationRotated   NotificationType = "rotated"
	NotificationTruncated NotificationType = "truncated"
)

// Notification is a discrete lifecycle event for the file being tailed.
type Notification struct {
	Type    NotificationType
	File    string
	Message string
}

// LineFunc is called, in order and never concurrently, for every new line a
// Tailer reads.
type LineFunc func(Entry)

// NotifyFunc is called for discrete events (rotation, truncation).
type NotifyFunc func(Notification)

// pollInterval is how often the sibling goroutine stats the file to detect
// rotation/truncation, since nxadm/tail follows correctly across both but
// doesn't itself expose a distinct event for either.
const pollInterval = 2 * time.Second

// Tailer follows a single concrete file from a starting byte offset,
// forwarding new lines and discrete lifecycle events to the callbacks
// supplied at construction. One Tailer is created per currently-active
// file; internal/tail.Manager owns starting, stopping, and replacing them.
type Tailer struct {
	path   string
	logger *slog.Logger

	onLine   LineFunc
	onNotify NotifyFunc

	t *nxadmtail.Tail

	statStop chan struct{}
	statDone chan struct{}
	lineDone chan struct{}
}

// NewTailer starts following path from startOffset (an absolute byte
// offset — typically wherever an initial ReadLastLines backfill left off,
// so there is neither a gap nor a duplicate between the backfill and the
// live stream that follows it).
func NewTailer(path string, startOffset int64, onLine LineFunc, onNotify NotifyFunc, logger *slog.Logger) (*Tailer, error) {
	if logger == nil {
		logger = slog.Default()
	}

	t, err := nxadmtail.TailFile(path, nxadmtail.Config{
		Follow:   true,
		ReOpen:   true,
		Location: &nxadmtail.SeekInfo{Offset: startOffset, Whence: io.SeekStart},
		Logger:   nxadmtail.DiscardingLogger,
	})
	if err != nil {
		return nil, err
	}

	tl := &Tailer{
		path:     path,
		logger:   logger,
		onLine:   onLine,
		onNotify: onNotify,
		t:        t,
		statStop: make(chan struct{}),
		statDone: make(chan struct{}),
		lineDone: make(chan struct{}),
	}

	go tl.consumeLines(startOffset)
	go tl.pollForRotation()
	return tl, nil
}

// Stop stops the underlying tail and the stat-polling goroutine, and waits
// for both of the Tailer's own goroutines to fully exit (no goroutine
// leaks).
func (tl *Tailer) Stop() error {
	close(tl.statStop)
	<-tl.statDone
	err := tl.t.Stop()
	<-tl.lineDone
	return err
}

func (tl *Tailer) consumeLines(startOffset int64) {
	defer close(tl.lineDone)

	// prevEnd tracks the byte offset immediately after the last line we
	// emitted, which is exactly the start offset of the next one — as
	// long as the file hasn't been reopened out from under us.
	prevEnd := startOffset
	for line := range tl.t.Lines {
		if line == nil {
			continue
		}
		if line.Err != nil {
			tl.logger.Warn("tail reported a line-level error", "file", tl.path, "error", line.Err)
			continue
		}

		entryOffset := prevEnd
		if line.SeekInfo.Offset < prevEnd {
			// The file was reopened (rotated away, or truncated in place)
			// between the previous line and this one, so nxadm/tail's
			// internal position reset to the new file's position and our
			// running cursor is stale for this one line only. Recompute a
			// best-effort start offset for just this transition line;
			// tracking is exact again from the very next line onward.
			entryOffset = line.SeekInfo.Offset - int64(len(line.Text)) - 1
			if entryOffset < 0 {
				entryOffset = 0
			}
		}
		prevEnd = line.SeekInfo.Offset

		if tl.onLine != nil {
			tl.onLine(Entry{Offset: entryOffset, Text: line.Text, File: tl.path, Ts: line.Time})
		}
	}
}

func (tl *Tailer) pollForRotation() {
	defer close(tl.statDone)

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	var lastSize int64
	var lastIno, lastDev uint64
	var haveIdentity bool
	if info, err := os.Stat(tl.path); err == nil {
		lastSize = info.Size()
		lastIno, lastDev, haveIdentity = fileIdentity(info)
	}

	for {
		select {
		case <-tl.statStop:
			return
		case <-ticker.C:
			info, err := os.Stat(tl.path)
			if err != nil {
				// Transient stat failure (e.g. mid-rename gap). Don't
				// flap notifications on a single missed poll; just retry
				// next tick without updating our baseline.
				continue
			}

			ino, dev, ok := fileIdentity(info)
			switch {
			case haveIdentity && ok && (ino != lastIno || dev != lastDev):
				tl.notify(NotificationRotated, "file was recreated")
			case haveIdentity && ok:
				if info.Size() < lastSize {
					tl.notify(NotificationTruncated, "")
				}
			default:
				// No reliable device+inode available (Windows build, or
				// Sys() didn't yield a *syscall.Stat_t) — fall back to a
				// size-only heuristic. This also fires for an actual
				// rotation, just without being able to name it as such.
				if info.Size() < lastSize {
					tl.notify(NotificationTruncated, "")
				}
			}

			lastSize = info.Size()
			lastIno, lastDev, haveIdentity = ino, dev, ok
		}
	}
}

func (tl *Tailer) notify(t NotificationType, message string) {
	if tl.onNotify == nil {
		return
	}
	tl.onNotify(Notification{Type: t, File: tl.path, Message: message})
}
