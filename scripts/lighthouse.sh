#!/bin/sh
# Lighthouse performance (mobile, simulated) for the home page, search and
# every post of a running preview; exits non-zero when one scores below
# MIN_SCORE. Each page's score is the median of RUNS runs, since single
# runs on a cold or shared machine swing by tens of points. Usage: go run ./src -url http://localhost:8080 -serve localhost:8080 &
#                   sh scripts/lighthouse.sh http://localhost:8080
set -eu
base=${1:-http://localhost:8080}
min=${MIN_SCORE:-97}
runs=${RUNS:-3}
out=$(mktemp -d)
paths="/ /search/ $(grep -o '<loc>[^<]*/posts/[^<]*</loc>' public/sitemap.xml | sed 's#<loc>[a-z]*://[^/]*##; s#</loc>##')"
failed=0
for path in $paths; do
  scores=""
  for run in $(seq "$runs"); do
    report="$out/$(echo "$path" | tr '/%' '__')-$run.json"
    npx -y lighthouse@13.5.0 "$base$path" --only-categories=performance --output=json --output-path="$report" \
      --chrome-flags="--headless=new --no-sandbox" --quiet >/dev/null
    scores="$scores $(node -e 'const r = require(process.argv[1]); console.log(Math.round(r.categories.performance.score * 100))' "$report")"
  done
  score=$(echo $scores | tr ' ' '\n' | sort -n | sed -n "$(( (runs + 1) / 2 ))p")
  echo "$score $path (runs:$scores)"
  if [ "$score" -lt "$min" ]; then failed=1; fi
done
if [ "$failed" -ne 0 ]; then echo "Lighthouse performance below $min; reports in $out" >&2; exit 1; fi
