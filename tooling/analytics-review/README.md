# analytics-review

Generates a markdown product-analytics review (search misses, refresh waits, dead ends, vitals, daily uniques) from the
observability Grafana instance.

## Setup

Provide the Grafana admin password in one of two ways (the environment wins):

- Environment: `GRAFANA_ADMIN_PASSWORD` (optionally `GRAFANA_URL`, default `https://observability.brawltome.app`).
- File: `~/.config/brawltome/observability.env` containing `GRAFANA_ADMIN_PASSWORD=...`.

## Usage

```sh
bun run --cwd tooling/analytics-review review --days 7 --out reports/review.md
```

`--days` (default 7) sets the comparison window; `--out` defaults to `analytics-review-<date>.md` in the invoking
directory. Daily uniques are approximate: visitor hashes rotate daily and on server restart.
