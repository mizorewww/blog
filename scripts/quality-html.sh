#!/bin/bash
# Read-only static HTML quality analyzer.
# stderr = human logs, stdout = structured JSON.
set -euo pipefail

MAX_FINDINGS=100
MAX_PER_CATEGORY_PER_FILE=20

fail() {
  local type="$1" msg="$2" suggestion="$3"
  if command -v jq >/dev/null 2>&1; then
    jq -n \
      --arg type "$type" \
      --arg msg "$msg" \
      --arg suggestion "$suggestion" \
      '{success: false, error: {type: $type, message: $msg, retryable: false, suggestion: $suggestion}}'
  else
    printf '{"success":false,"error":{"type":"%s","message":"%s","suggestion":"%s","retryable":false}}\n' \
      "$type" "$msg" "$suggestion"
  fi
  exit 1
}

command -v jq >/dev/null 2>&1 || \
  fail "missing_dependency" "jq is required for safe JSON output" "Install jq and rerun this check"

[ $# -ge 1 ] || fail "invalid_input" "No target provided" "Usage: $0 <file_or_directory>"
TARGET="$1"
[ -e "$TARGET" ] || fail "invalid_input" "Target not found: $TARGET" "Pass an existing file or directory path"

ISSUES=()
WARNINGS=()

add_limited_warning() {
  local -n count_ref="$1"
  local file="$2"
  local line="$3"
  local message="$4"

  if [ "$count_ref" -ge "$MAX_PER_CATEGORY_PER_FILE" ]; then
    if [ "$count_ref" -eq "$MAX_PER_CATEGORY_PER_FILE" ]; then
      WARNINGS+=("$file:0: $message findings truncated (>${MAX_PER_CATEGORY_PER_FILE} in this file)")
    fi
    count_ref=$((count_ref + 1))
    return
  fi

  WARNINGS+=("$file:$line: $message")
  count_ref=$((count_ref + 1))
}

analyze_html() {
  local file="$1"
  echo "Analyzing: $file" >&2

  grep -qi "<!doctype html>" "$file" || ISSUES+=("$file:0: Missing HTML5 doctype")
  grep -qi 'charset.*utf-8' "$file" || WARNINGS+=("$file:0: Missing or non-UTF-8 charset")
  grep -qi 'name="viewport"' "$file" || ISSUES+=("$file:0: Missing viewport meta tag")
  grep -qi '<html[^>]*lang=' "$file" || ISSUES+=("$file:0: Missing lang attribute on <html>")
  grep -qi '<title>' "$file" || ISSUES+=("$file:0: Missing <title> tag")

  local alt_count=0
  while IFS=: read -r ln tag; do
    if grep -qE 'alt=' <<<"$tag"; then continue; fi
    add_limited_warning alt_count "$file" "$ln" "<img> without alt attribute"
  done < <(grep -noE '<img[^>]*>' "$file" || true)

  local http_count=0
  while IFS=: read -r ln _; do
    add_limited_warning http_count "$file" "$ln" "HTTP URL in resource attribute"
  done < <(grep -noiE '\b(href|src|action|poster)=["'\'']http://[^"'\'']+' "$file" || true)
  local missingimg_count=0
  local url=""
  while IFS= read -r url; do
    if [ ! -e "${TARGET}${url}" ]; then
      if [ "$missingimg_count" -lt "$MAX_PER_CATEGORY_PER_FILE" ]; then
        ISSUES+=("$file:0: Image reference not found on disk: ${url}")
      fi
      missingimg_count=$((missingimg_count + 1))
    fi
  done < <(grep -oE '/static/[A-Za-z0-9_./-]+\.(webp|avif|jpg|jpeg|png|gif)' "$file" || true)
}

if [ -d "$TARGET" ]; then
  while IFS= read -r -d '' file; do
    analyze_html "$file"
  done < <(find "$TARGET" \( -name "*.html" -o -name "*.htm" \) -not -path "*/pagefind/*" -print0)
elif [ -f "$TARGET" ]; then
  analyze_html "$TARGET"
else
  fail "invalid_input" "Target is not a regular file or directory: $TARGET" "Pass a path to an .html/.htm file or a directory"
fi

issue_total=${#ISSUES[@]}
warning_total=${#WARNINGS[@]}

to_json_array() {
  printf '%s\n' "$@" | jq -Rs 'split("\n") | map(select(length > 0))'
}

if [ "$issue_total" -gt 0 ]; then
  issues_json=$(to_json_array "${ISSUES[@]:0:$MAX_FINDINGS}")
else
  issues_json='[]'
fi

if [ "$warning_total" -gt 0 ]; then
  warnings_json=$(to_json_array "${WARNINGS[@]:0:$MAX_FINDINGS}")
else
  warnings_json='[]'
fi

echo "Scanned. $issue_total issues, $warning_total warnings." >&2

jq -n \
  --argjson issues "$issues_json" \
  --argjson warnings "$warnings_json" \
  --argjson issue_total "$issue_total" \
  --argjson warning_total "$warning_total" \
  --argjson max "$MAX_FINDINGS" \
  '{
    success: true,
    issues: $issues,
    warnings: $warnings,
    issueCount: $issue_total,
    warningCount: $warning_total,
    truncated: (($issue_total > $max) or ($warning_total > $max))
  }'
