#!/usr/bin/env bash
# Opens (or adds to) a GitHub issue when a scheduled job fails. Runs inside GitHub Actions.
set -u
title="${JOB} failed"
# Frequent jobs hit harmless hiccups (a slow download, nflverse mid-update), so they only
# raise the alarm when the previous run also failed. The "Test the alarm" switch skips this.
if [ "${ALERT_AFTER:-1}" -gt 1 ] && [ "${TEST_ALERT:-false}" != "true" ]; then
  prev="$(gh run list --workflow "$WORKFLOW_FILE" --limit 10 --json databaseId,status,conclusion \
          --jq "[.[] | select(.databaseId != ${RUN_ID} and .status == \"completed\" and .conclusion != \"cancelled\" and .conclusion != \"skipped\")][0].conclusion" 2>/dev/null)"
  if [ "$prev" != "failure" ]; then
    echo "First failure in a row; an issue will open if the next run fails too."
    exit 0
  fi
fi
log="$(tail -n 40 run.log 2>/dev/null || echo 'No output was captured; see the full log.')"
body="$(printf '**%s** failed on %s (UTC).\n\nFull log: %s\n\nLast lines of output:\n\n```\n%s\n```\n\nNothing was saved, so the page keeps showing the last good data. The next scheduled run will try again. If this keeps happening, paste this issue into a chat with Claude.' "$JOB" "$(date -u '+%Y-%m-%d %H:%M')" "$RUN_URL" "$log")"
gh label create data-job-failure --color B60205 --description "A scheduled data job failed" --force >/dev/null 2>&1 || true
n="$(gh issue list --label data-job-failure --state open --search "\"$title\" in:title" --json number --jq '.[0].number' 2>/dev/null)"
if [ -n "$n" ]; then
  gh issue comment "$n" --body "$body"
else
  gh issue create --title "$title" --label data-job-failure --body "$body"
fi
