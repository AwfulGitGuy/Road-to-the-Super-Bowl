# Maintaining Road to the Super Bowl

Everything runs on GitHub: **GitHub Actions** refreshes the data and sets up each new season, and **GitHub Pages** hosts the site straight from this repository. There's nothing to run by hand in a normal season.

## What's in the repository

| Path | What it is |
| --- | --- |
| `index.html` | The whole page. It reads its data from the `data/` folder next to it. |
| `data/config.json` | Which season is current, its Super Bowl, number of games, and when the refresh stops for the year. |
| `data/season-YYYY.json` | One file per season: schedule, scores, betting lines, starting quarterbacks, QB stats, playoff games. |
| `data/priors-YYYY.json` | Each season's starting values, carried over from the season before. |
| `data/super_bowl_hosts.json` | Where each Super Bowl is played. **The one file you update by hand, once a year (optional).** |
| `data/last_check.txt` | A small monthly marker that keeps GitHub from pausing the schedules. |
| `scripts/update.py` | The refresh: downloads the latest nflverse files and rebuilds the current season's data. |
| `scripts/new_season.py` | The yearly setup: once next season's schedule is published, builds its starting values and data files. |
| `scripts/build_data.py`, `scripts/rollover.py`, `scripts/common.py` | The work behind those two, including the safety checks. |
| `scripts/report_failure.sh`, `scripts/report_success.sh` | Open and close the "job failed" issue. |
| `.github/workflows/` | The two schedules GitHub runs. Copies are in `workflows-copy/` in case a computer hides the `.github` folder. |

## What happens on its own

- **Data refresh** (`daily-refresh.yml`): every 30 minutes during game windows (Thursday night, Sunday from late morning to past midnight, Monday night, and Saturdays late in the season), and every 3 hours the rest of the week. Each run downloads the latest scores, betting lines, projected starting quarterbacks, and QB stats, checks them, and saves the current season's file only if something changed. GitHub Pages republishes the site a minute or so later. The refresh keeps going through the playoffs and the Super Bowl, then does nothing until the new season is set up.
- **New-season setup** (`new-season.yml`): Mondays in August and September. The first time next season's schedule is out, it carries over quarterback values and team ratings from the season that just ended, builds the new season's files, and makes it the current season. On every other Monday it does nothing. You can also run it early from the Actions tab any time after the schedule is released in May; if it's too early, it just says so.
- **Timing:** GitHub runs schedules on a best-effort basis, so runs are often 5 to 20 minutes late at busy times.

## How you'll hear about problems

When a job fails, it opens an issue titled **"Data refresh failed"** or **"New-season setup failed"**, with the last lines of the error and a link to the full log, and GitHub emails you. The frequent refresh waits for **two failures in a row** before opening an issue, since single hiccups (nflverse mid-update, a slow download) fix themselves on the next run. If the same job keeps failing, it adds comments instead of new issues, and once a run succeeds it closes the issue itself with a "Fixed" note.

Nothing bad is ever saved: a failed run leaves the last good data in place.

If an issue stays open for more than a day or so, copy its text into a chat with Claude (or anyone who knows Python) to get it fixed.

**To test the alarm:** Actions tab → **Data refresh** → **Run workflow**, tick **Test the alarm**, and run it. An issue should open within a few minutes (the test skips the two-in-a-row rule). Run it again unticked and the issue closes itself.

## The one yearly chore (optional)

Before each season, add its Super Bowl to `data/super_bowl_hosts.json` (edit it on GitHub with the pencil icon). The entry is keyed by the year the season starts:

```json
"2028": {"name": "Super Bowl LXIII", "venue": "Stadium name", "hosts": ["TEAM"]}
```

`hosts` is the team code(s) if the stadium is an NFL team's home field (SoFi Stadium is `["LA", "LAC"]`, MetLife Stadium is `["NYG", "NYJ"]`), otherwise `[]`. It only matters if that team reaches the game; if you forget, the Super Bowl is treated as a neutral site. 2026 and 2027 are already filled in.

It's also worth a glance at the **Actions** tab each August. GitHub pauses schedules in public repositories after 60 days with no activity. The refresh's commits and the monthly `last_check.txt` marker should prevent that, but a paused schedule shows a banner with an **Enable workflow** button.

## If the NFL changes its format

If the league changes the number of teams or games, the divisions, or the playoff structure, the new-season job stops and reports it rather than saving anything wrong. The page and scripts will need an update at that point.

## Security

- **No secrets, logins, or personal data.** The site has no accounts, forms, cookies, or analytics. Visitors' team choices and what-if picks stay in their own browser. The jobs use only GitHub's built-in per-run token, limited to this repository.
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
2. **Quarterbacks** are split out: each has a value from his efficiency per play over recent seasons, sized by how betting lines react to QB changes.
3. **Win chances** come from the point gap using a curve fitted to 2002–2017 games and checked on 2018–2025.
4. **Each simulated season** lets team strength drift more the further out a game is, applies the NFL tiebreakers (checked against all 48 real conference brackets from 2002–2025), seeds 7 teams per conference, and plays every round, using real results for playoff games already played.
