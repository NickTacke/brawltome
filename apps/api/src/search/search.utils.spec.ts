import { describe, expect, it } from 'vitest';
import {
  matchesNameOrBasePrefix,
  normalizeForPrefixMatch,
  sanitizeSearchQuery,
} from './search.utils';

describe('api/search.utils', () => {
  it('sanitizeSearchQuery preserves letters/numbers/space/dash/underscore and pipes', () => {
    expect(sanitizeSearchQuery('  Foo|Bar!!  ')).toBe('  Foo | Bar  ');
    expect(sanitizeSearchQuery('naïve-日本語')).toBe('naïve-日本語');
  });

  it('normalizeForPrefixMatch normalizes whitespace + case + pipe spacing', () => {
    expect(normalizeForPrefixMatch('  Foo|Bar   ')).toBe('foo | bar');
  });

  it('matchesNameOrBasePrefix matches full name prefix or post-pipe base prefix', () => {
    expect(matchesNameOrBasePrefix('TAG | PlayerName', 'tag')).toBe(true);
    expect(matchesNameOrBasePrefix('TAG | PlayerName', 'player')).toBe(true);
    expect(matchesNameOrBasePrefix('TAG | PlayerName', 'x')).toBe(false);
  });
});
