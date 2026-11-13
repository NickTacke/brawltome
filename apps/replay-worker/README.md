# replay-worker

Parses uploaded replays for BrawlTome. It runs on the replay VM (VM 106 on the AX42), not with the other services: the
private `ax42-infra` repo installs bh-native, the game folders and this worker's image there (`docs/replay.md`).

It claims a job from the api's `/internal/replays` routes, writes the replay to `/work`, plays it with
`bhnative replay <game folder> --stdin`, and posts the line bh-native prints back, gzipped. A few bh-native processes
run for the newest patch and one for the previous patch; a replay from the previous patch goes to that one.

| Setting | Default |
| --- | --- |
| `REPLAY_WORKER_TOKEN` | required, the api's `replay_worker_token` secret |
| `REPLAY_API_URL` | `https://api.brawltome.app` |
| `REPLAY_BHNATIVE_PATH` | `/opt/bhnative/current/bhnative` (its folder name is the build it reports) |
| `REPLAY_GAME_ROOT` | `/srv/brawlhalla`, one folder per patch |
| `REPLAY_WORK_DIR` | `/work` |
| `REPLAY_NEWEST_PROCESSES` / `REPLAY_PREVIOUS_PROCESSES` | `3` / `1`; each takes about 1.5 GB |

Tests use a fake bh-native (`tests/fake-bhnative.ts`): `bun test apps/replay-worker`.
