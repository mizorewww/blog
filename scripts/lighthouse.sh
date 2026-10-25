#!/bin/sh
# Lighthouse performance (mobile, simulated) for the home page, search and
# every post of a running preview; exits non-zero when one scores below
# MIN_SCORE. Usage: go run ./src -url http://localhost:8080 -serve localhost:8080 &
#                   sh scripts/lighthouse.sh http://localhost:8080
set -eu
base=${1:-http://localhost:8080}
min=${MIN_SCORE:-97}
out=$(mktemp -d)
paths="/ /search/ $(grep -o '<loc>[^<]*/posts/[^<]*</loc>' public/sitemap.xml | sed 's#<loc>[a-z]*://[^/]*##; s#</loc>##')"
failed=0
for path in $paths; do
  report="$out/$(echo "$path" | tr '/%' '__').json"
  npx -y lighthouse@13.5.0 "$base$path" --only-categories=performance --output=json --output-path="$report" \
    --chrome-flags="--headless=new --no-sandbox" --quiet >/dev/null
  score=$(node -e 'const r = require(process.argv[1]); console.log(Math.round(r.categories.performance.score * 100))' "$report")
  echo "$score $path"
  if [ "$score" -lt "$min" ]; then failed=1; fi
done
if [ "$failed" -ne 0 ]; then echo "Lighthouse performance below $min; reports in $out" >&2; exit 1; fi
