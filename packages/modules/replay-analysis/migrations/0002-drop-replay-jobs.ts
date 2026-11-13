// the prototype's jobs were only ever Nick's own tests; replays now live in the replays module
const sql = `DROP SCHEMA IF EXISTS replay_analysis CASCADE;
`

export const dropReplayJobs = {
  identity: 'replay-analysis/0002',
  predecessor: 'replay-analysis/0001',
  checksum: '8d365bddd96920f44088a8423a1b6dcbdfd3e92512fbf2fa083849c1157cc4ea',
  sql,
} as const
