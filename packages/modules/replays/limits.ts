// a replay file is about 25 KB; anything near this size isn't one
export const MAX_REPLAY_BYTES = 2 * 1024 * 1024
export const MAX_PENDING_PER_ACCOUNT = 20
export const MAX_UPLOADS_PER_DAY = 200
export const LEASE_SECONDS = 600
export const MAX_ATTEMPTS = 3
// how long a patch may go unreported by the worker before its replay files are deleted
export const FILE_GRACE_DAYS = 7
// a line is 180-485 KB raw and a few tens of KB gzipped
export const MAX_LINE_GZIP_BYTES = 8 * 1024 * 1024
export const MAX_LINE_BYTES = 32 * 1024 * 1024
// bounds what one art file upload from the worker holds in memory
export const MAX_ART_FILE_BYTES = 8 * 1024 * 1024
// bounds one missing-files question from the worker
export const MAX_ART_PATHS_PER_CALL = 2000
