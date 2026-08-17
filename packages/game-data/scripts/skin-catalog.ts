import type { Legend, Skin } from '../src/types'

export type CostumeSource = {
  costumeName: string
  skinId: number
  ownerHero: string
  isCrossover: boolean
}

export type OfficialCrossover = {
  displayName: string
  slug: string
  legendSlug: string
  imageUrl: string
}

const OFFICIAL_CROSSOVER_ENDPOINT = 'https://cms.brawlhalla.com/graphql'
export const OFFICIAL_CROSSOVER_QUERY = `{
  crossovers(first: 500, where: {orderby: {field: DATE, order: ASC}}) {
    nodes {
      title
      slug
      crossoverFields {
        icon { sourceUrl }
        legend { ... on Legend { title slug } }
      }
    }
  }
}`

const normalizedName = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()

const requiredText = (value: unknown, message: string): string => {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(message)
  return value.trim()
}

export function parseOfficialCrossovers(value: unknown): OfficialCrossover[] {
  if (!value || typeof value !== 'object') throw new Error('official crossover response must be an object')
  const payload = value as {
    errors?: unknown
    data?: { crossovers?: { nodes?: unknown } }
  }
  if (payload.errors !== undefined && (!Array.isArray(payload.errors) || payload.errors.length > 0)) {
    throw new Error('official crossover response contains GraphQL errors')
  }
  const nodes = payload.data?.crossovers?.nodes
  if (!Array.isArray(nodes)) throw new Error('official crossover response is missing data.crossovers.nodes')

  const slugs = new Set<string>()
  const names = new Set<string>()
  return nodes.map((node, index) => {
    if (!node || typeof node !== 'object') throw new Error(`official crossover row ${index} is incomplete`)
    const row = node as {
      title?: unknown
      slug?: unknown
      crossoverFields?: { icon?: { sourceUrl?: unknown }; legend?: { slug?: unknown } }
    }
    const displayName = requiredText(row.title, `official crossover row ${index} has invalid title`)
    const slug = requiredText(row.slug, `official crossover row ${index} has invalid slug`)
    const legendSlug = requiredText(
      row.crossoverFields?.legend?.slug,
      `official crossover row ${index} has invalid legend slug`,
    )
    const imageUrl = requiredText(
      row.crossoverFields?.icon?.sourceUrl,
      `official crossover row ${index} has invalid image URL`,
    )
    let parsedImageUrl: URL
    try {
      parsedImageUrl = new URL(imageUrl)
    } catch {
      throw new Error(`official crossover row ${index} has invalid image URL`)
    }
    if (parsedImageUrl.protocol !== 'https:' || !parsedImageUrl.hostname) {
      throw new Error(`official crossover row ${index} has invalid image URL`)
    }

    if (slugs.has(slug)) throw new Error(`duplicate official crossover slug ${slug}`)
    slugs.add(slug)
    const name = normalizedName(displayName)
    if (names.has(name)) throw new Error(`duplicate normalized official crossover name ${name}`)
    names.add(name)
    return { displayName, slug, legendSlug, imageUrl }
  })
}

export async function fetchOfficialCrossovers(fetcher: typeof fetch = fetch): Promise<OfficialCrossover[]> {
  const response = await fetcher(OFFICIAL_CROSSOVER_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: OFFICIAL_CROSSOVER_QUERY }),
  })
  if (!response.ok) throw new Error(`official crossover request failed with ${response.status}`)
  return parseOfficialCrossovers(await response.json())
}

const trueTokens = new Set(['TRUE', 'True', 'true', '1'])
const falseTokens = new Set(['', 'FALSE', 'False', 'false', '0'])

export function parseCostumeSources(rows: readonly string[][]): CostumeSource[] {
  const header = rows[0] ?? []
  const column = (name: string): number => {
    const index = header.indexOf(name)
    if (index === -1) throw new Error(`costumeTypes: column ${name} not found in header`)
    return index
  }
  const nameIndex = column('CostumeName')
  const idIndex = column('CostumeID')
  const ownerIndex = column('OwnerHero')
  const crossoverIndex = column('IsCrossover')

  return rows.slice(1).flatMap((row) => {
    const costumeName = row[nameIndex] ?? ''
    if (!costumeName || costumeName === 'Template') return []
    const rawId = row[idIndex] ?? ''
    if (rawId.trim() === '') throw new Error(`costumeTypes: ${costumeName} has invalid CostumeID`)
    const skinId = Number(rawId)
    if (!Number.isSafeInteger(skinId) || skinId < 0) {
      throw new Error(`costumeTypes: ${costumeName} has invalid CostumeID ${rawId}`)
    }
    const crossover = row[crossoverIndex] ?? ''
    if (!trueTokens.has(crossover) && !falseTokens.has(crossover)) {
      throw new Error(`costumeTypes: ${costumeName} has invalid IsCrossover ${JSON.stringify(crossover)}`)
    }
    return [
      {
        costumeName,
        skinId,
        ownerHero: row[ownerIndex] ?? '',
        isCrossover: trueTokens.has(crossover),
      },
    ]
  })
}

export function buildSkinCatalog(
  costumes: readonly CostumeSource[],
  legends: readonly Legend[],
  roster: readonly OfficialCrossover[],
  aliases: Readonly<Record<string, string>> = {},
): Skin[] {
  const legendByHeroName = new Map(legends.map((legend) => [legend.heroName, legend]))
  const rosterBySlug = new Map(roster.map((entry) => [entry.slug, entry]))
  const rosterByName = new Map(roster.map((entry) => [normalizedName(entry.displayName), entry]))
  const seenIds = new Set<number>()

  return costumes
    .map((costume): Skin => {
      if (seenIds.has(costume.skinId)) throw new Error(`duplicate skin id ${costume.skinId}`)
      seenIds.add(costume.skinId)
      const legend = legendByHeroName.get(costume.ownerHero)
      if (!legend)
        throw new Error(`skin ${costume.costumeName} (${costume.skinId}) has unknown owner ${costume.ownerHero}`)

      if (!costume.isCrossover) {
        return {
          skinId: costume.skinId,
          skinName: costume.costumeName,
          legendId: legend.heroId,
          isCrossover: false,
          displayName: null,
          imageUrl: null,
        }
      }

      const alias = aliases[costume.costumeName]
      const official = alias ? rosterBySlug.get(alias) : rosterByName.get(normalizedName(costume.costumeName))
      if (alias && !official) {
        throw new Error(`alias ${costume.costumeName} targets missing official roster slug ${alias}`)
      }
      if (!official) {
        throw new Error(`crossover skin ${costume.costumeName} (${costume.skinId}) has no official roster entry`)
      }
      if (normalizedName(official.legendSlug) !== normalizedName(legend.displayName)) {
        throw new Error(
          `crossover skin ${costume.costumeName} (${costume.skinId}) owner ${legend.displayName} conflicts with official ${official.legendSlug}`,
        )
      }
      return {
        skinId: costume.skinId,
        skinName: costume.costumeName,
        legendId: legend.heroId,
        isCrossover: true,
        displayName: official.displayName,
        imageUrl: official.imageUrl,
      }
    })
    .sort((left, right) => left.skinId - right.skinId)
}
