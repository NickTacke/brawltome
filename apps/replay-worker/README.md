# replay-worker

Parses uploaded replays for BrawlTome. It runs on the replay VM (VM 106 on the AX42), not with the other services: the
private `ax42-infra` repo installs bh-native, the game folders and this worker's image there (`docs/replay.md`).

It claims a job from the api's `/internal/replays` routes, writes the replay to `/work`, plays it with
`bhnative replay <game folder> --stdin`, and posts the line bh-native prints back, gzipped. A few bh-native processes
run for the newest patch and one for the previous patch; a replay from the previous patch goes to that one.

With the brawlhalla-anims export bundle mounted, one more loop draws art. It claims an art job from
`/internal/replays/art`, runs the bundle's `export.ts plan` on the match's line, asks the api which of the planned
files the art bucket lacks, downloads the art groups and map file it has (the render reads them), then runs `render`
for the rest. A warm job runs `warm` for a whole patch instead. Every new file goes up through the api, sheets and
packs first and map files last, since the api refuses a map file before the sheets it names; then the manifest. While
the export draws, only `REPLAY_PROCESSES_DURING_ART` bh-native processes run, so the export has the memory. The worker
never holds storage keys.

With a bundle that has `render --sets` (brawlhalla-anims 44e8246 or later), the worker reports the sets' format with
each claim, and the api hands it two more things:

- A predraw job draws a patch's pre-drawn sets. It runs `predraw name`, asks which sets the art bucket lacks, runs
  `predraw draw` with those in `--have`, and sends the sheets, then the set files, then the index once every set it
  names is stored. A draw that fails some sets or runs out of time still sends the sets it finished, so running the job
  again draws only the rest. The api keeps the index as the patch's once the job ends.
- A match job of a patch with an index carries the index's path. The worker downloads it and runs `plan --sets` and
  `render --sets`, which name the players' sets instead of drawing them. If the bucket lacks one of the sets, the job
  goes back for ten minutes instead. Without an index the match is drawn as before.

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
| `REPLAY_ART_WARM_TIMEOUT_MS` | `3600000`; a plan or render is stopped after 15 minutes, a warm after this |
| `REPLAY_ART_PREDRAW_TIMEOUT_MS` | `43200000`, for `predraw name` and for `predraw draw` each |
| `REPLAY_PREDRAW_CHECK` | off; `1` runs `predraw draw --check`, which leaves out a set further than its limit from the look baked in |

Tests use a fake bh-native (`tests/fake-bhnative.ts`) and a fake export (`tests/fake-export.ts`):
`bun test apps/replay-worker`.
