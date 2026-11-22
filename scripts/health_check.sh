#!/usr/bin/env bash
# Runs inside the data refresh (GitHub Actions), after the data is saved. Two checks:
#  1. If GitHub's latest site deploy ("pages build and deployment") failed, ask GitHub to build the site again,
#     so the site doesn't stay behind the data until the next change (deploys fail now and then on GitHub's side).
#  2. If either workflow has been disabled, raise the alarm (a disabled workflow never fails, so nothing else would).
# Problems talking to GitHub here never fail the refresh; a disabled workflow does, through run_warning.txt.
set -u
repo="$GITHUB_REPOSITORY"
last="$(gh api "repos/$repo/actions/runs?per_page=30" --jq '[.workflow_runs[] | select(.name == "pages build and deployment")] | if length == 0 then "" else (if any(.[]; .status != "completed") then "running" else .[0].conclusion end) end' 2>/dev/null || echo unknown)"
echo "Latest site deploy: ${last:-none}"
if [ "$last" = "failure" ] || [ "$last" = "cancelled" ] || [ "$last" = "timed_out" ]; then
  if gh api -X POST "repos/$repo/pages/builds" >/dev/null 2>&1; then echo "Asked GitHub to build the site again."
  else echo "NOTE: couldn't ask GitHub to rebuild the site; the next data change will deploy it."; fi
fi
states="$(gh api "repos/$repo/actions/workflows" --jq '.workflows[] | select(.path | test("daily-refresh|new-season")) | "\(.path) \(.state)"' 2>/dev/null)"
echo "$states"
if [ -n "$states" ] && echo "$states" | grep -qv ' active$'; then
  echo "A workflow is not active (it may have been disabled): $(echo "$states" | grep -v ' active$' | tr '\n' ' ')Turn it back on from the Actions tab." >> run_warning.txt
fi
exit 0
