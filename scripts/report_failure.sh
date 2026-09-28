#!/usr/bin/env bash
# Opens (or adds to) a GitHub issue when a scheduled job fails. Runs inside GitHub Actions.
set -u
title="${JOB} failed"
log="$(tail -n 40 run.log 2>/dev/null || echo 'No output was captured; see the full log.')"
body="$(printf '**%s** failed on %s (UTC).\n\nFull log: %s\n\nLast lines of output:\n\n```\n%s\n```\n\nNothing was saved, so the page keeps showing the last good data. The next scheduled run will try again. If this keeps happening, paste this issue into a chat with Claude.' "$JOB" "$(date -u '+%Y-%m-%d %H:%M')" "$RUN_URL" "$log")"
gh label create data-job-failure --color B60205 --description "A scheduled data job failed" --force >/dev/null 2>&1 || true
n="$(gh issue list --label data-job-failure --state open --search "\"$title\" in:title" --json number --jq '.[0].number' 2>/dev/null)"
if [ -n "$n" ]; then
  gh issue comment "$n" --body "$body"
else
  gh issue create --title "$title" --label data-job-failure --body "$body"
fi
