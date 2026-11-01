# Roadmap

Last reviewed 2026-10-31. GitHub issues carry `priority: now`, `priority: next` or `priority: later`; this page is the
short version and the reasoning behind the order.

**Direction:** make BrawlTome the place with the freshest data and features nobody else has (the in-game overlay,
replay analysis). Don't chase parity with other stat sites unless it serves one of those or fixes a real user complaint.

## State on 2026-10-31

- Production has been stable since the 2026-10-05 Postgres disk outage. Postgres uses 77 GB of a 188 GB image, with
  disk alerts in place.
- The hourly deep crawl covers about 280k 1v1 players plus the solo and 2v2 boards. Profiles show how old each section's
  data is.
- Alerting was reworked from about 66 Discord messages a day into a status board plus pings for critical alerts only.
  See [operations/alerts.md](operations/alerts.md).

## Now

| Issue | Why now |
| --- | --- |
| #364 External uptime / dead man's switch | If the host goes down nobody hears about it today. Needs a healthchecks.io or UptimeRobot account |
| #337 Deploy smoke test and rollback (PR #359) | Every push to `master` deploys, and a bad release should undo itself |
| #336 Push refresh results (PR #360) | Refreshed data shows up the moment it is ready, with fewer polling requests |
| #335 Search misses | About 11% of searches find nothing. "Can't find myself" is the first impression for new users |
| #338 Restore drill | Backups are verified but a restore has only been run once. The next run must use the IO-capped script |

## Next

| Issue | Notes |
| --- | --- |
| #332 Overlay rework | The main differentiator. Needs a Windows machine. Includes the old #101 retry gap |
| #116 Matches and replays | The backend foundation exists (replay ingestion, R2 storage, bridge). Next is the user-facing match history |
| #244 Statistics activation | Decide whether `/stats` goes public, based on data-confidence evidence |
| #365 Drop the V2 `public` tables | 1.5 GB of dead tables. Decide whether to archive them first |
| #366 Postgres maintenance window | Reclaim bloat after retention (rankings 42 GB, statistics 20 GB); align the image |

## Later

- #246 Desktop Windows 11 release path (signing, updater). Do it after the overlay rework.
- #119 Shareable player cards.
- #363 Discord bot: `/help`, `/leaderboard`, account linking.

## Recently closed as not planned

Tournaments (#117), the learning section (#118), the public API (#121), the seed script (#122), and the V3
launch-acceptance checklists (#242, #249). The reasons are in each issue. Earlier unfinished work is kept as
`archive/*` git tags; list them with `git tag -l 'archive/*'`.
