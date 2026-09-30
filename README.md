# Road to the Super Bowl

**Live site: [awfulgitguy.github.io/Road-to-the-Super-Bowl](https://awfulgitguy.github.io/Road-to-the-Super-Bowl/)**

An NFL season simulator. It plays out the rest of the season 10,000 times to estimate every team's chances of making the playoffs, winning its division, and winning the Super Bowl, and updates itself throughout the season.

## What you can do on the page

- **See the league at a glance:** Super Bowl favorites, each division's likely winner, and the week's biggest risers and fallers.
- **Follow your team:** playoff chances, likely win total, possible playoff seeds, next game, and a chart of how its odds have moved week by week. Your pick is remembered in your browser.
- **See the schedule:** every week's games with kickoff times in your own time zone, stadiums, final scores (with upsets marked), each team's win chance, and which channel or service usually carries each game. Switch to "just my team" for a full season view.
- **Play "what if":** pick winners for upcoming games right in the schedule, or change a team's starting quarterback, and every number re-runs.
- **Know who to root for:** your team's panel ranks this week's other games by how much each result changes its playoff chances.
- **See the projected bracket:** the likeliest playoff field and who's favored in each round.
- **Look back:** past seasons (2021 onward) with the full playoff bracket and how the odds moved all year.
- **Share a team:** add its code to the link, for example [`#PIT`](https://awfulgitguy.github.io/Road-to-the-Super-Bowl/#PIT) or [`#BUF`](https://awfulgitguy.github.io/Road-to-the-Super-Bowl/#BUF).

## How it works

1. **Team ratings** come from betting-market point spreads, which are the most accurate public forecasts of NFL games. Recent weeks count more, and each season starts from the previous season's ratings, pulled partway back toward average.
2. **Quarterbacks are rated separately,** from their recent efficiency per play, so a backup starting only affects the games he starts. When a team's regular starter is hurt, later games give him a growing chance of being back, based on how often injured starters returned in 2012–2025.
3. **Every remaining game is simulated** from those ratings, with team strength allowed to drift more the further out a game is. The NFL's tiebreakers decide seeding, and the playoffs are played out (using real results once playoff games are final).
4. **The settings were tested on past seasons,** tuned on 2002–2017 and checked on 2018–2025. The page also shows a score-only rating built without betting lines, and how it compared with the market over those seasons.

The page's "How the model works" section has the details.

## Data

Schedules, scores, betting lines, and player stats come from the free, volunteer-run [nflverse](https://github.com/nflverse) project. The data refreshes four times an hour from August through the Super Bowl, and each new season is set up automatically in late summer.

This is an independent fan project with no connection to the NFL or its teams.

---

Maintaining the site (schedules, alerts, the yearly setup, running it locally): see [docs/MAINTAINING.md](docs/MAINTAINING.md).
