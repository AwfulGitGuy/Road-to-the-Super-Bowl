# Maintaining Road to the Super Bowl

Everything runs on GitHub: **GitHub Actions** refreshes the data and sets up each new season, and **GitHub Pages** hosts the site straight from this repository. There's nothing to run by hand in a normal season.

## What's in the repository

| Path | What it is |
| --- | --- |
| `index.html` | The whole page, assembled from `src/` by `scripts/build_page.py`. It reads its data from the `data/` folder next to it. |
| `src/` | The page's source: `model.js` (the simulation), `app.js` (the page), `page_head.html` and `page_body.html` (layout and styles), and the score-only rating (`perf.js`, `perf_const.json`). **Edit these, then run `python scripts/build_page.py`**, rather than editing `index.html` directly. |
| `data/rooting-YYYY.json` | "Who to root for": every team's chances after each result of the coming week's games. Rebuilt by the refresh. |
| `data/config.json` | Which season is current, its Super Bowl, number of games, and when the refresh stops for the year. |
| `data/season-YYYY.json` | One file per season: schedule, scores, betting lines, starting quarterbacks, QB stats, playoff games. |
| `data/priors-YYYY.json` | Each season's starting values, carried over from the season before. |
| `data/super_bowl_hosts.json` | Where each Super Bowl is played. **The one file you update by hand, once a year (optional).** |
| `data/last_check.txt` | A small monthly marker (left over from when GitHub's own schedules were used; harmless). |
| `scripts/update.py` | The refresh: downloads the latest nflverse files and rebuilds the current season's data. |
| `scripts/new_season.py` | The yearly setup: once next season's schedule is published, builds its starting values and data files. |
| `scripts/build_data.py`, `scripts/rollover.py`, `scripts/common.py` | The work behind those two, including the safety checks. |
| `scripts/rooting.js` | Builds the "who to root for" file by playing the same 10,000 seasons twice for each game (once with each result). Runs with Node, which GitHub's machines already have; if it fails, the refresh carries on and the page hides that panel. |
| `scripts/build_page.py` | Assembles `index.html` from `src/`. |
| `scripts/report_failure.sh`, `scripts/report_success.sh` | Open and close the "job failed" issue. |
| `.github/workflows/` | The two schedules GitHub runs. Copies are in `workflows-copy/` in case a computer hides the `.github` folder. |

## What happens on its own

- **Data refresh** (`daily-refresh.yml`): four times an hour, at :07, :17, :37 and :47 (just after nflverse's usual update times of :05, :15, :35 and :45), August through February (runs before the new season is set up just say there's nothing to do). Each run downloads the latest scores, betting lines, projected starting quarterbacks, QB stats, and the injury report and roster status (used to spot an injured regular starter; if those two downloads fail, the run carries on without them), checks them, and saves the current season's file only if something changed. GitHub Pages republishes the site a minute or so later. The refresh keeps going through the playoffs and the Super Bowl, then does nothing until the new season is set up.
- **New-season setup** (`new-season.yml`): Mondays at 9:47 AM Eastern in August and September. The first time next season's schedule is out, it carries over quarterback values and team ratings from the season that just ended, builds the new season's files, and makes it the current season. On every other Monday it does nothing. You can also run it early from the Actions tab any time after the schedule is released in May; if it's too early, it just says so.
- **The timer:** both jobs are started by two jobs in a free **cron-job.org** account (Eastern time), which call GitHub's "run workflow" address with a key that can only start workflows in this repository. GitHub's own schedules were removed: the first scheduled run started almost two hours late, and GitHub switches schedules off in public repositories after 60 days without activity, which would have happened every spring. You can still start either job by hand from the Actions tab.
- **The key expires July 1, 2027** (chosen in the offseason on purpose). To renew: GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → generate a new one for this repository only, with **Actions: Read and write**, then paste it into the cron-job.org job's `Authorization` header as `Bearer <key>`. If it lapses, cron-job.org emails you when calls fail.
- **cron-job.org job settings, for reference:** the refresh job POSTs to `https://api.github.com/repos/AwfulGitGuy/Road-to-the-Super-Bowl/actions/workflows/daily-refresh.yml/dispatches` (Minutes 7, 17, 37 and 47, every hour, August–February), and the new-season job to the same address with `new-season.yml` (Minutes 47, Hour 9, Mondays, August–September). Both send body `{"ref":"main"}` and headers `Authorization: Bearer <key>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2026-03-10`, `Content-Type: application/json`, `User-Agent: road-to-the-super-bowl-refresh`. A 2xx response means it worked.

## How you'll hear about problems

When a job fails, it opens an issue titled **"Data refresh failed"** or **"New-season setup failed"**, with the last lines of the error and a link to the full log, and GitHub emails you. The frequent refresh waits for **three failures in a row** (about 40 minutes) before opening an issue, since single hiccups (nflverse mid-update, a slow download) fix themselves on the next run. If the same job keeps failing, it adds comments instead of new issues, and once a run succeeds it closes the issue itself with a "Fixed" note.

A run also counts as failed if a game that kicked off two or more days ago still has no score. That usually means nflverse has stopped updating, or a game was postponed (in which case it clears once nflverse moves the game's date).

Nothing bad is ever saved: a failed run leaves the last good data in place.

If an issue stays open for more than a day or so, copy its text into a chat with Claude (or anyone who knows Python) to get it fixed.

**To test the alarm:** Actions tab → **Data refresh** → **Run workflow**, tick **Test the alarm**, and run it. An issue should open within a few minutes (the test skips the three-in-a-row rule). Run it again unticked and the issue closes itself.

## Super Bowl sites (nothing to do for now)

The Super Bowl's host team gets half the usual home-field edge if it reaches the game, so the model needs to know where each Super Bowl is played. Two sources cover it:

- **Once the game is set:** nflverse lists the Super Bowl about two weeks before it's played, with its stadium. The refresh reads the site from there and works out the host team from which team plays its home games in that stadium. No list needed.
- **Before that (preseason and regular season):** `data/super_bowl_hosts.json`, keyed by the year the season starts. Each time the new-season job runs (Mondays in August and September, or by hand), `scripts/sb_sites.py` checks Wikipedia's page for each of the next six Super Bowls and adds any newly awarded site, with the host team worked out from the schedule. If Wikipedia shows a different site for an existing entry (a Super Bowl that was moved), it waits for a second check at least 7 days later showing the same new site, then updates the entry and records the change under `_lastCheck` (`updated`). One-off edits to Wikipedia, like vandalism, are usually reverted long before that. A change waiting for its second check is listed under `_pending`. To add or fix one by hand, use the pencil icon on GitHub:

```json
"2030": {"name": "Super Bowl LXV", "venue": "Stadium name", "hosts": ["TEAM"]}
```

`hosts` is the team code(s) if the stadium is an NFL team's home field (SoFi Stadium is `["LA", "LAC"]`, MetLife Stadium is `["NYG", "NYJ"]`), otherwise `[]`. If a season is missing, its Super Bowl is treated as a neutral site until the game appears in the data, which changes the odds by a fraction of a point at most.

It's also worth a glance at the **Actions** tab in mid-August: there should be a "Set up the new season" run from each Monday. If there isn't, check the cron-job.org account (an expired key is the likely cause).

## If something breaks (for you, or whoever helps you)

Everything needed to understand and fix the site is in this repository: the page's source in `src/`, the data jobs in `scripts/`, the schedules in `.github/workflows/`, and these notes. A new Claude session (or anyone who knows Python) can start by reading this file and `README.md`; no earlier chat is needed. A failure issue's text, pasted into that conversation, is usually enough to find the cause.

Likely failures, most likely first:

| What you'll see | Likely cause | Fix |
| --- | --- | --- |
| cron-job.org emails that calls fail with **401** | The key expired (July 1, 2027) or was deleted | Make a new key (see "The key expires…" above) and paste it into both cron-job.org jobs |
| No new "Data refresh" runs in the Actions tab, and no emails | The cron-job.org jobs were paused or the account lapsed | Log in to cron-job.org and turn the jobs back on |
| A "Data refresh failed" issue mentioning a download | nflverse is down or moved a file | Usually fixes itself; if it lasts more than a day, check nflverse's GitHub for announcements |
| A "Data refresh failed" issue listing failed checks (unknown team, game count, missing scores) | nflverse changed its data, or a game was postponed | Read the listed problem; a postponed game clears once nflverse moves its date |
| A failure in "Set up Python" or a Python error after GitHub updates its servers | A newer Python changed something | The jobs use the newest Python 3 on purpose; the error message shows the line to fix |

To test changes on your own computer, see "Running it on your own computer" below.

## If the NFL changes its format

If the league changes the number of teams or games, the divisions, or the playoff structure, the new-season job stops and reports it rather than saving anything wrong. The page and scripts will need an update at that point.

## Security

- **No secrets, logins, or personal data.** The site has no accounts, forms, cookies, or analytics. Visitors' team choices and what-if picks stay in their own browser. Inside GitHub, the jobs use only GitHub's built-in per-run token, limited to this repository. The one outside key belongs to the cron-job.org timer: it is limited to this repository and can only start, re-run or cancel workflow runs (it can't read or change code), and it is stored only in that cron-job.org account, never in this repository.
- **Untrusted input is checked twice.** The refresh script rejects data with unexpected team codes, IDs, dates, or characters, and the page ignores any data file that fails the same checks.
- **Locked-down page.** The page tells browsers it may only load its own files and Google Fonts, and may send data nowhere.
- **Pinned building blocks.** The workflows use exact commits of GitHub's official `checkout` and `setup-python` actions.
- **On your side:** keep two-factor sign-in on for GitHub, and limit the Claude GitHub App to only the repositories it needs (or remove it when you're not making changes with Claude).

## Running it on your own computer (optional)

With Python 3 installed, from the repository folder:

```
python scripts/update.py          # refresh the current season's data
python scripts/new_season.py      # set up next season, if its schedule is out
python -m http.server 8000        # then open http://localhost:8000
```

Open the page through that local server rather than by double-clicking `index.html`, so it can read the data files.

## How the model works (short version)

1. **Team ratings** come from betting-market point spreads (recent weeks count more), starting each season from last season's ratings pulled 40% of the way back toward average.
2. **Quarterbacks** are split out: each has a value from his efficiency per play over recent seasons, sized by how betting lines react to QB changes. Next week's starter comes from nflverse's projected starters. After that, the latest starter is assumed to keep playing, except when the team's regular starter (most starts over its last 8 games of last season plus this season) is Out or Doubtful: then each later game blends in his chance of being back, from how often injured starters returned in 2012–2025 (concussions return faster). Starters on injured reserve are assumed to stay out, and benched starters to stay benched.
   - *How it was tested:* the return chances were fitted on 2012–2018 and scored on 2019–2025, and the other way around. For teams with an injured starter, it improved win-probability log loss on games 2–9 weeks ahead (0.6288 to 0.6243, 3,358 games) and the Brier score of their playoff odds (0.1088 to 0.1034, 699 team-weeks). Blending in returns from injured reserve didn't help, so it isn't used.
3. **Win chances** come from the point gap using a curve fitted to 2002–2017 games and checked on 2018–2025.
4. **Each simulated season** lets team strength drift more the further out a game is, applies the NFL tiebreakers (checked against all 48 real conference brackets from 2002–2025), seeds 7 teams per conference, and plays every round, using real results for playoff games already played.
