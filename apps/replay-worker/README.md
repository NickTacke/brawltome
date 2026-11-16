# replay-worker

Parses uploaded replays for BrawlTome. It runs on the replay VM (VM 106 on the AX42), not with the other services: the
private `ax42-infra` repo installs bh-native, the game folders and this worker's image there (`docs/replay.md`).

It claims a job from the api's `/internal/replays` routes, writes the replay to `/work`, plays it with
`bhnative replay <game folder> --stdin`, and posts the line bh-native prints back, gzipped. A few bh-native processes
run for the newest patch and one for the previous patch; a replay from the previous patch goes to that one.

With the brawlhalla-anims export bundle mounted, one more loop draws art. It claims an art job from
`/internal/replays/art`, runs the bundle's `export.ts plan` on the match's line, asks the api which of the planned
files the art bucket lacks, downloads the art groups and map file it has (the render reads them), then runs `render`
for the rest. A warm job runs `warm` for a whole patch instead. Every new file goes up through the api, then the
manifest. While the export draws, only `REPLAY_PROCESSES_DURING_ART` bh-native processes run, so the export has the
memory. The worker never holds storage keys.

| Setting | Default |
| --- | --- |
| `REPLAY_WORKER_TOKEN` | required, the api's `replay_worker_token` secret |
| `REPLAY_API_URL` | `https://api.brawltome.app` |
| `REPLAY_BHNATIVE_PATH` | `/opt/bhnative/current/bhnative` (its folder name is the build it reports) |
| `REPLAY_GAME_ROOT` | `/srv/brawlhalla`, one folder per patch |
| `REPLAY_WORK_DIR` | `/work` |
| `REPLAY_NEWEST_PROCESSES` / `REPLAY_PREVIOUS_PROCESSES` | `3` / `1`; each takes about 1.5 GB |
| `REPLAY_ANIMS_PATH` | `/opt/anims/current`, the export bundle; art is off without its `scripts/export.ts` |
| `REPLAY_PROCESSES_DURING_ART` | `1`, the bh-native processes left running while the export draws |

Tests use a fake bh-native (`tests/fake-bhnative.ts`) and a fake export (`tests/fake-export.ts`):
`bun test apps/replay-worker`.
