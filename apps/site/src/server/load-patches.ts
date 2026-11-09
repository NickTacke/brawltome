import { cachedRead } from './cached-read'
import { readPatchFeed } from './patch-feed'

// patches ship every few weeks, so an hour late is unnoticeable and keeps us to about 24 requests a day to the cms
const patchesFreshMs = 60 * 60 * 1000
const patchesRetryMs = 5 * 60 * 1000

/** The latest patch notes, shared by every visitor for an hour. Null when the feed has never been read. */
export const loadPatches = cachedRead(readPatchFeed, { freshMs: patchesFreshMs, retryMs: patchesRetryMs })
