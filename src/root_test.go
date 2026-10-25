package main

import (
	"os"
	"testing"
)

// TestMain runs the tests from the repository root, where the build finds
// site.json, content/, templates/ and static/, just as go run ./src does.
func TestMain(m *testing.M) {
	if err := os.Chdir(".."); err != nil {
		panic(err)
	}
	os.Exit(m.Run())
}
