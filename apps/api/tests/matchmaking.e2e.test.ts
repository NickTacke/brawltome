import { describe, test } from 'bun:test'

// Real roundtrip deferred to the desktop/overlay plan; unit tests cover the ingest command.
const shouldRun =
  process.env.MATCHMAKING_E2E === '1' &&
  !!process.env.DATABASE_URL &&
  !!process.env.R2_ACCESS_KEY_ID &&
  !!process.env.R2_SECRET_ACCESS_KEY &&
  !!process.env.R2_ENDPOINT &&
  !!process.env.R2_BUCKET

describe.if(shouldRun)('matchmaking ingest E2E', () => {
  test('placeholder', () => {})
})
