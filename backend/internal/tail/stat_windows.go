//go:build windows

package tail

import "os"

// fileIdentity has no reliable, allocation-free device+inode equivalent
// available via os.FileInfo on Windows. This is fine: the real deployment
// target is Linux/Alpine (see stat_unix.go); on Windows (local dev only)
// rotation detection simply falls back to the size-only heuristic in
// pollForRotation.
func fileIdentity(info os.FileInfo) (ino, dev uint64, ok bool) {
	return 0, 0, false
}
