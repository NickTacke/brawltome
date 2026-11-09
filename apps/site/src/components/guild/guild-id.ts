const largestGuildId = 2_147_483_647
const canonicalIdPattern = /^[1-9]\d*$/

/** The guild id in a url, or null for anything the API could never know, so bad urls cost no API call. */
export function parseGuildId(value: string): number | null {
  if (!canonicalIdPattern.test(value)) return null

  const guildId = Number(value)

  return guildId <= largestGuildId ? guildId : null
}
