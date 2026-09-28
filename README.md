# Road to the Super Bowl

An NFL season simulator. It rates every team from betting-market point spreads and each starting quarterback's recent efficiency, then plays out the rest of the season 10,000 times to give every team its chances of making the playoffs, winning its division, and winning the Super Bowl. It includes what-if picks, a starting-QB override, week-by-week odds history, a score-only comparison rating with a 2018–2025 backtest, and past seasons.

This folder runs entirely on its own on GitHub, for free: GitHub Pages hosts the page, and GitHub Actions refreshes the data every morning and sets up each new season in late summer. No AI and no paid services are involved.

Data comes from the free, volunteer-run [nflverse](https://github.com/nflverse) project. Please keep that credit if you share the page.

---

## What's in the folder

| Path | What it is |
| --- | --- |
| `index.html` | The whole page. It reads its data from the `data/` folder next to it. |
| `data/config.json` | Which season is current, its Super Bowl, number of games, and when the daily refresh should stop. |
| `data/season-YYYY.json` | One file per season: schedule, scores, betting lines, starting quarterbacks, QB stats. |
| `data/priors-YYYY.json` | Each season's starting values (carried over from the season before). |
| `data/super_bowl_hosts.json` | Where each Super Bowl is played. **The one file you update by hand, once a year (optional).** |
| `scripts/update.py` | Daily refresh: downloads the latest nflverse files and rebuilds the current season's data. |
| `scripts/new_season.py` | Yearly setup: once next season's schedule is published, builds its starting values and data files. |
| `scripts/build_data.py`, `scripts/rollover.py`, `scripts/common.py` | The work behind the two scripts above, including the safety checks. |
| `scripts/report_failure.sh`, `scripts/report_success.sh` | Open and close the "job failed" issue. |
| `.github/workflows/` | The two schedules GitHub runs. Copies are in `workflows-copy/` in case your computer hides the `.github` folder. |
| `netlify.toml` | Settings for hosting on Netlify (optional). |

---

## One-time setup (about 20–30 minutes)

### 1. Create a GitHub account and a repository
1. Sign up at [github.com](https://github.com) (free).
2. Click **+** (top right) → **New repository**.
3. Name it something like `steelers-sim`. Choose **Public** (free GitHub Pages sites must be public; there's nothing personal in this project). Leave "Add a README" unchecked. Click **Create repository**.

### 2. Upload the files
The simplest route is the browser:
1. On the new repository's page, click **uploading an existing file**.
2. Drag in everything from this folder: `index.html`, `README.md`, and the `data`, `scripts`, and `workflows-copy` folders. Click **Commit changes**.
3. Add the two schedules. They must live at `.github/workflows/`, and a folder starting with a dot is often hidden on Macs and skipped by drag-and-drop, so create them by hand:
   - Click **Add file** → **Create new file**.
   - In the name box type `.github/workflows/daily-refresh.yml` (typing the slashes creates the folders).
   - Open `workflows-copy/daily-refresh.yml` from this folder in any text editor, copy everything, and paste it in. Click **Commit changes**.
   - Repeat for `.github/workflows/new-season.yml` using `workflows-copy/new-season.yml`.

   (If you use GitHub Desktop or git instead, just copy the whole folder, including `.github`, and push.)

### 3. Let the schedules save data
1. In the repository, go to **Settings** → **Actions** → **General**.
2. Under **Workflow permissions**, choose **Read and write permissions**. Click **Save**.

### 4. Turn on the website
1. Go to **Settings** → **Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**, branch **main**, folder **/ (root)**. Click **Save**.
3. After a minute or two, the page shows your site's address, something like `https://yourname.github.io/steelers-sim/`. Bookmark it.

### 4b. Or host it on Netlify instead (works with a private repository too)
If you'd rather use Netlify, skip step 4 (or do both; they don't conflict):
1. In Netlify, click **Add new site** → **Import an existing project** → **GitHub**, and pick this repository.
2. Leave **Build command** empty and set **Publish directory** to `.` (the included `netlify.toml` already says this).
3. Click **Deploy**. Netlify gives you a link, and it redeploys by itself each time the daily refresh saves new data.

Because Netlify can deploy from private repositories on its free plan, this route lets you switch the repository to **Private** (Settings → General → Danger Zone → Change visibility) and still have a working link. Private repositories also aren't subject to GitHub's 60-day schedule pause.

### 5. Run the first refresh
1. Go to the **Actions** tab. If GitHub asks, click the button to enable workflows.
2. Click **Daily data refresh** → **Run workflow** → **Run workflow**.
3. After about a minute it should show a green check. Reload your site: the "data updated" time at the top should be recent.

That's it. From now on it runs every morning on its own.

---

## What happens on its own

- **Every morning** (12:52 UTC, which is 8:52 AM Eastern in the fall): the daily refresh downloads the latest scores, betting lines, projected starting quarterbacks, and QB stats, checks them, and saves the current season's file. The page picks it up the next time you open it. After the last regular-season game it stops doing anything until the next season is set up.
- **Mondays in August and September:** the new-season job checks whether next season's schedule is out. The first time it is, it carries over quarterback values and team ratings from the season that just ended, builds the new season's files, and makes it the current season. On every other Monday it does nothing.
- **Safety checks:** if a download fails, a score goes missing, a score looks impossible, or the league's format changes (different teams, number of games, or divisions), the job saves nothing, is marked failed, and opens an issue (see below). The page keeps showing the last good data, and the next scheduled run tries again.

## How you'll hear about problems

When either job fails, it opens an issue in this repository titled **"Daily data refresh failed"** or **"New-season setup failed"**, with the last lines of the error and a link to the full log. GitHub emails you about new issues in your own repositories (check **Settings → Notifications** on your GitHub account if you don't see them). If the same job fails again, it adds a comment instead of opening a second issue, and once a run succeeds it closes the issue itself with a "Fixed" note. Many problems are temporary (nflverse late or briefly down) and fix themselves by the next run.

If an issue stays open for more than a couple of days, copy its text into a chat with Claude (or anyone who knows Python) to get it fixed.

**Test the alarm once:** Actions tab → **Daily data refresh** → **Run workflow**, tick **Test the alarm**, and run it. You should get an issue and an email within a few minutes. Then run it again normally (unticked) and the issue closes itself.

## The one yearly chore (optional)

Before each season, add its Super Bowl to `data/super_bowl_hosts.json` (edit it right on GitHub with the pencil icon). The entry is keyed by the year the season starts:

```json
"2028": {"name": "Super Bowl LXIII", "venue": "Stadium name", "hosts": ["TEAM"]}
```

`hosts` is the team code(s) if the stadium is an NFL team's home field (for example SoFi Stadium is `["LA", "LAC"]`, MetLife Stadium is `["NYG", "NYJ"]`), otherwise `[]`. It only matters if that team reaches the game. If you forget, the Super Bowl is treated as a neutral site. 2026 and 2027 are already filled in.

## Things worth knowing

- **Your picks** (what-if winners and QB choices) are saved in your browser only, per season.
- **GitHub pauses schedules after 60 days of no activity** in public repositories. The daily job saves a small `data/last_check.txt` once a month to prevent that. If a schedule is ever paused anyway, the Actions tab shows a banner with an **Enable workflow** button. It's worth a quick look each August.
- **If the NFL changes its format** (for example an 18-game season or a new playoff structure), the new-season job stops and reports it rather than saving anything wrong. The page code will need a small update at that point.
- **The model's weak spot:** it can't know how long an injured quarterback will be out, so it assumes the latest starter keeps playing. Use the Starting QB menu to test a return.

## Running it on your own computer (optional)

With Python 3 installed, from this folder:

```
python scripts/update.py          # refresh the current season's data
python scripts/new_season.py      # set up next season, if its schedule is out
python -m http.server 8000        # then open http://localhost:8000
```

The page needs to be opened through that local server (not by double-clicking `index.html`) so it can read the data files. Double-clicking still works, but shows only the data built into the page.

## How the model works (short version)

1. **Team ratings** come from betting-market point spreads, with recent weeks counting more, starting each season from last season's ratings pulled 40% of the way back toward average.
2. **Quarterbacks** are split out: each has a value from his efficiency per play over recent seasons, sized by how betting lines react to QB changes, so a backup only lowers his team for the games he starts.
3. **Win chances** come from the point gap using a curve fitted to 2002–2017 games and checked on 2018–2025.
4. **Each simulated season** lets team strength drift more the further out a game is, applies the NFL tiebreakers (checked against all 48 real conference brackets from 2002–2025), seeds 7 teams per conference, and plays every round.

The page's "How the model works" section has the details.
