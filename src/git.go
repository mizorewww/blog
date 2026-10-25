package main

import (
	"os/exec"
	"path/filepath"
	"strings"
)

// Commit is one change to a post's source, newest first.
type Commit struct{ Hash, Short, Date, Subject string }

// gitHistory lists the commits that touched path; outside a repository it is empty.
func gitHistory(path string) []Commit {
	out, err := exec.Command("git", "log", "--follow", "--format=%H%x1f%cs%x1f%s", "--", filepath.ToSlash(path)).Output()
	if err != nil {
		return nil
	}
	var commits []Commit
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		parts := strings.SplitN(line, "\x1f", 3)
		if len(parts) == 3 && len(parts[0]) >= 7 {
			commits = append(commits, Commit{parts[0], parts[0][:7], parts[1], parts[2]})
		}
	}
	return commits
}

// gitHead is the commit being built, shown in the footer.
func gitHead() string {
	out, err := exec.Command("git", "rev-parse", "HEAD").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}
