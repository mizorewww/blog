package main

import (
	"crypto/sha256"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
)

// One content version keeps asset URLs and relative font URLs consistent.
func assetVersion(root string) (string, error) {
	hash := sha256.New()
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		name, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		fmt.Fprintf(hash, "%s\x00", filepath.ToSlash(name))
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		defer file.Close()
		_, err = io.Copy(hash, file)
		return err
	})
	return fmt.Sprintf("%x", hash.Sum(nil))[:16], err
}

// Keep author-linked images at their original paths; version only site assets.
func copyAssets(stage, version string) error {
	entries, err := os.ReadDir("static")
	if err != nil {
		return err
	}
	for _, entry := range entries {
		source := filepath.Join("static", entry.Name())
		target := filepath.Join(stage, "static", entry.Name())
		if entry.Name() == "fonts" || entry.Name() == "style.css" || entry.Name() == "favicon.svg" {
			target = filepath.Join(stage, "static", version, entry.Name())
		}
		if entry.IsDir() {
			if err = os.CopyFS(target, os.DirFS(source)); err != nil {
				return err
			}
		} else {
			body, err := os.ReadFile(source)
			if err != nil {
				return err
			}
			if err = os.MkdirAll(filepath.Dir(target), 0755); err != nil {
				return err
			}
			if err = os.WriteFile(target, body, 0644); err != nil {
				return err
			}
		}
	}
	return nil
}
