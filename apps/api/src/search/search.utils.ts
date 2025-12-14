export const sanitizeSearchQuery = (query: string): string => {
  const withNormalizedPipeSpacing = query.replace(/\s*\|\s*/g, ' | ');
  return withNormalizedPipeSpacing.replace(/[^\p{L}\p{N}_\s\-|]/gu, '');
};

export const normalizeForPrefixMatch = (input: string): string => {
  return input
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
};

export const getPostTagPortion = (name: string): string => {
  const parts = name.split('|');
  return (parts[parts.length - 1] ?? name).trim();
};

export const matchesNameOrBasePrefix = (
  target: string,
  query: string
): boolean => {
  const q = normalizeForPrefixMatch(query);
  if (!q) return false;

  const t = normalizeForPrefixMatch(target);
  if (t.startsWith(q)) return true;

  const base = normalizeForPrefixMatch(getPostTagPortion(target));
  return base.startsWith(q);
};
