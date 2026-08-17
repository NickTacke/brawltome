import { describe, expect, test } from 'bun:test'
import {
  type OfficialCrossover,
  buildSkinCatalog,
  parseCostumeSources,
  parseOfficialCrossovers,
} from '../scripts/skin-catalog'
import type { Legend } from '../src/types'

const legends: Legend[] = [
  {
    heroId: 3,
    heroName: 'Viking',
    displayName: 'BÖDVAR',
    strength: 6,
    dexterity: 6,
    weight: 5,
    speed: 5,
    weaponOne: 'Hammer',
    weaponTwo: 'Sword',
    isActive: true,
    isBeta: true,
  },
  {
    heroId: 10,
    heroName: 'Ninja',
    displayName: 'HATTORI',
    strength: 4,
    dexterity: 6,
    weight: 4,
    speed: 8,
    weaponOne: 'Sword',
    weaponTwo: 'Spear',
    isActive: true,
    isBeta: true,
  },
]

const officialNode = {
  title: 'John Cena',
  slug: 'john-cena',
  crossoverFields: {
    icon: { sourceUrl: 'https://cms.brawlhalla.com/c/uploads/2021/12/Cena.png' },
    legend: { title: 'Hattori', slug: 'hattori' },
  },
}
const officialResponse = (...nodes: unknown[]) => ({ data: { crossovers: { nodes } } })
const costumes = [
  { costumeName: 'Viking', skinId: 3, ownerHero: 'Viking', isCrossover: false },
  { costumeName: 'Cena', skinId: 408, ownerHero: 'Ninja', isCrossover: true },
]

describe('official crossover parsing', () => {
  test('parses the complete strict response', () => {
    expect(parseOfficialCrossovers(officialResponse(officialNode))).toEqual([
      {
        displayName: 'John Cena',
        slug: 'john-cena',
        legendSlug: 'hattori',
        imageUrl: 'https://cms.brawlhalla.com/c/uploads/2021/12/Cena.png',
      },
    ])
  })

  test('rejects GraphQL errors even when partial data is present', () => {
    expect(() =>
      parseOfficialCrossovers({
        ...officialResponse(officialNode),
        errors: [{ message: 'partial resolver failure' }],
      }),
    ).toThrow('official crossover response contains GraphQL errors')
  })

  test('rejects empty fields and a bare HTTPS URL', () => {
    expect(() => parseOfficialCrossovers(officialResponse({ ...officialNode, title: '  ' }))).toThrow(
      'official crossover row 0 has invalid title',
    )
    expect(() =>
      parseOfficialCrossovers(
        officialResponse({
          ...officialNode,
          crossoverFields: { ...officialNode.crossoverFields, icon: { sourceUrl: 'https://' } },
        }),
      ),
    ).toThrow('official crossover row 0 has invalid image URL')
  })

  test('rejects duplicate slugs and normalized official names', () => {
    expect(() =>
      parseOfficialCrossovers(officialResponse(officialNode, { ...officialNode, title: 'Second', slug: 'john-cena' })),
    ).toThrow('duplicate official crossover slug john-cena')
    expect(() =>
      parseOfficialCrossovers(
        officialResponse(officialNode, { ...officialNode, title: 'Jöhn-Cena', slug: 'john-cena-alt' }),
      ),
    ).toThrow('duplicate normalized official crossover name johncena')
  })
})

describe('costume source parsing', () => {
  test('accepts only explicit true and false tokens', () => {
    expect(
      parseCostumeSources([
        ['CostumeName', 'CostumeID', 'OwnerHero', 'IsCrossover'],
        ['Viking', '3', 'Viking', 'FALSE'],
        ['DefaultBase', '4', 'Viking', ''],
        ['Cena', '408', 'Ninja', 'TRUE'],
        ['SecondBase', '409', 'Ninja', '0'],
        ['SecondCrossover', '410', 'Ninja', '1'],
      ]),
    ).toEqual([
      { costumeName: 'Viking', skinId: 3, ownerHero: 'Viking', isCrossover: false },
      { costumeName: 'DefaultBase', skinId: 4, ownerHero: 'Viking', isCrossover: false },
      { costumeName: 'Cena', skinId: 408, ownerHero: 'Ninja', isCrossover: true },
      { costumeName: 'SecondBase', skinId: 409, ownerHero: 'Ninja', isCrossover: false },
      { costumeName: 'SecondCrossover', skinId: 410, ownerHero: 'Ninja', isCrossover: true },
    ])
  })

  test('rejects blank IDs before numeric conversion', () => {
    expect(() =>
      parseCostumeSources([
        ['CostumeName', 'CostumeID', 'OwnerHero', 'IsCrossover'],
        ['Cena', '   ', 'Ninja', 'TRUE'],
      ]),
    ).toThrow('costumeTypes: Cena has invalid CostumeID')
  })

  test('rejects unknown nonblank crossover tokens', () => {
    for (const token of ['YES', 'enabled']) {
      expect(() =>
        parseCostumeSources([
          ['CostumeName', 'CostumeID', 'OwnerHero', 'IsCrossover'],
          ['Cena', '408', 'Ninja', token],
        ]),
      ).toThrow(`costumeTypes: Cena has invalid IsCrossover ${JSON.stringify(token)}`)
    }
  })
})

describe('skin catalog join', () => {
  const roster = (): OfficialCrossover[] => parseOfficialCrossovers(officialResponse(officialNode))

  test('joins a reviewed alias and emits deterministic skin rows', () => {
    expect(buildSkinCatalog(costumes, legends, roster(), { Cena: 'john-cena' })).toEqual([
      {
        skinId: 3,
        skinName: 'Viking',
        legendId: 3,
        isCrossover: false,
        displayName: null,
        imageUrl: null,
      },
      {
        skinId: 408,
        skinName: 'Cena',
        legendId: 10,
        isCrossover: true,
        displayName: 'John Cena',
        imageUrl: 'https://cms.brawlhalla.com/c/uploads/2021/12/Cena.png',
      },
    ])
  })

  test('rejects every unknown owner, including a non-crossover owner', () => {
    expect(() => buildSkinCatalog([{ ...costumes[0], ownerHero: 'Missing' }], legends, [], {})).toThrow(
      'skin Viking (3) has unknown owner Missing',
    )
    expect(() =>
      buildSkinCatalog([{ ...costumes[1], ownerHero: 'Missing' }], legends, roster(), { Cena: 'john-cena' }),
    ).toThrow('skin Cena (408) has unknown owner Missing')
  })

  test('rejects unresolved crossovers, owner mismatches, duplicate IDs, and missing alias targets', () => {
    expect(() => buildSkinCatalog([{ ...costumes[1], costumeName: 'Unknown' }], legends, [], {})).toThrow(
      'crossover skin Unknown (408) has no official roster entry',
    )
    expect(() =>
      buildSkinCatalog(costumes.slice(1), legends, [{ ...roster()[0], legendSlug: 'bodvar' }], {
        Cena: 'john-cena',
      }),
    ).toThrow('crossover skin Cena (408) owner HATTORI conflicts with official bodvar')
    expect(() =>
      buildSkinCatalog([costumes[0], { ...costumes[0], costumeName: 'Duplicate' }], legends, [], {}),
    ).toThrow('duplicate skin id 3')
    expect(() => buildSkinCatalog(costumes.slice(1), legends, roster(), { Cena: 'missing-slug' })).toThrow(
      'alias Cena targets missing official roster slug missing-slug',
    )
  })
})
