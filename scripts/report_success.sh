#!/usr/bin/env bash
# Closes an open failure issue for this job once a run succeeds again. Runs inside GitHub Actions.
set -u
title="${JOB} failed"
for n in $(gh issue list --label data-job-failure --state open --search "\"$title\" in:title" --json number --jq '.[].number' 2>/dev/null); do
  gh issue close "$n" --comment "Fixed: ${JOB} ran successfully on $(date -u '+%Y-%m-%d') (UTC)."
done
exit 0
