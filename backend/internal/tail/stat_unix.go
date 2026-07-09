//go:build !windows

package tail

import (
	"os"
	"syscall"
)

// fileIdentity extracts device+inode from a FileInfo on POSIX systems,
// which is how rotation is reliably distinguished from truncation-in-place
// (same inode, smaller size) on the real deployment target (Linux/Alpine).
func fileIdentity(info os.FileInfo) (ino, dev uint64, ok bool) {
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return 0, 0, false
	}
	return uint64(st.Ino), uint64(st.Dev), true
}
