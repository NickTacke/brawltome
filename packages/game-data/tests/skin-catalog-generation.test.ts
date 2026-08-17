import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { refreshGeneratedData, resolveExtractRoot, validateGeneratedData } from '../scripts/ingest'
import {
  OFFICIAL_CROSSOVER_QUERY,
  type OfficialCrossover,
  buildSkinCatalog,
  fetchOfficialCrossovers,
  parseCostumeSources,
  parseOfficialCrossovers,
} from '../scripts/skin-catalog'
import type { Legend } from '../src/types'

const preflightMessage =
  'BRAWLTOME_SWZ_EXTRACT_ROOT must be an absolute directory containing Game/_manifest.json and Init/_manifest.json'

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

test('requires an explicit complete extract root before refresh', () => {
  expect(() => resolveExtractRoot(undefined)).toThrow(preflightMessage)
  expect(() => resolveExtractRoot('research/swz-extract/out')).toThrow(preflightMessage)

  const root = mkdtempSync(join(tmpdir(), 'brawltome-extract-'))
  try {
    mkdirSync(join(root, 'Game'))
    writeFileSync(join(root, 'Game', '_manifest.json'), '[]')
    expect(() => resolveExtractRoot(root)).toThrow(preflightMessage)
    mkdirSync(join(root, 'Init'))
    writeFileSync(join(root, 'Init', '_manifest.json'), '[]')
    expect(resolveExtractRoot(root)).toBe(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('validates skins against legends before generated files are emitted', () => {
  expect(() =>
    validateGeneratedData({
      legends,
      levels: [
        {
          levelId: 1,
          levelName: 'TestMap',
          displayName: 'Test Map',
          devOnly: false,
          testLevel: false,
          fileName: null,
        },
      ],
      powers: [
        {
          powerId: 1,
          powerName: 'TestPower',
          baseDamage: 1,
          fixedImpulse: 0,
          variableImpulse: 0,
          minimumImpulse: 0,
          castTime: '1',
          recoverTime: '1',
          fixedRecoverTime: '1',
          fixedStunTime: 0,
          cooldownTime: 0,
          onHitCooldownTime: 0,
          aoeRadiusX: 0,
          aoeRadiusY: 0,
          isAirPower: false,
          isSignature: false,
          isMultihit: false,
          isAntiair: false,
          endOnHit: false,
          cancelGravity: false,
          wallCancel: false,
          hurtboxName: null,
        },
      ],
      hurtboxes: [
        {
          hurtboxName: 'TestBox',
          hurtboxId: 1,
          animClass: 'Test',
          animName: 'Idle',
          width: 1,
          height: 1,
        },
      ],
      skins: [
        {
          skinId: 408,
          skinName: 'Cena',
          legendId: 999,
          isCrossover: true,
          displayName: 'John Cena',
          imageUrl: 'https://cms.brawlhalla.com/cena.png',
        },
      ],
    }),
  ).toThrow('skin 408 references unknown legend 999')
})

test('leaves disposable generated outputs untouched when late refresh validation fails', async () => {
  const root = mkdtempSync(join(tmpdir(), 'brawltome-refresh-'))
  const outputDir = join(root, 'generated')
  const generatedPaths = ['legends.ts', 'levels.ts', 'powers.ts', 'hurtboxes.ts', 'skins.ts'].map((name) =>
    join(outputDir, name),
  )

  try {
    mkdirSync(join(root, 'Game'))
    mkdirSync(join(root, 'Init'))
    mkdirSync(outputDir)
    for (const path of generatedPaths) writeFileSync(path, 'sentinel')
    writeFileSync(
      join(root, 'Game', '_manifest.json'),
      JSON.stringify([
        { i: 0, sniff: 'HeroTypes' },
        { i: 1, sniff: 'binary' },
        { i: 2, sniff: 'binary' },
        { i: 3, sniff: 'binary' },
      ]),
    )
    writeFileSync(join(root, 'Init', '_manifest.json'), JSON.stringify([{ i: 0, sniff: 'LevelTypes' }]))
    writeFileSync(
      join(root, 'Game', 'entry-000.xml'),
      '<Root><HeroType id="1"><HeroID>3</HeroID><HeroName>Viking</HeroName><HeroDisplayName>Bodvar</HeroDisplayName></HeroType><HeroType id="2"><HeroID>3</HeroID><HeroName>Ninja</HeroName><HeroDisplayName>Hattori</HeroDisplayName></HeroType></Root>',
    )
    writeFileSync(
      join(root, 'Init', 'entry-000.xml'),
      '<Root><LevelType id="1"><LevelID>1</LevelID><LevelName>TestMap</LevelName><DisplayName>Test Map</DisplayName></LevelType></Root>',
    )
    writeFileSync(
      join(root, 'Game', 'entry-001.bin'),
      'powerTypes\nPowerName,PowerID,BaseDamage,VariableImpulse,FixedImpulse,MinimumImpulse,CastTime,FixedRecoverTime,RecoverTime,FixedStunTime,CooldownTime,OnHitCooldownTime,AoERadiusX,AoERadiusY,IsAirPower,IsSignature,IsAntiair,IsMultihit,EndOnHit,CancelGravity,WallCancel,Hurtbox\nTestPower,1,1,0,0,0,1,1,1,0,0,0,0,0,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,TestBox\n',
    )
    writeFileSync(
      join(root, 'Game', 'entry-002.bin'),
      'hurtboxTypes\nHurtboxName,HurtboxID,AnimClass,AnimName,Width,Height\nTestBox,1,Test,Idle,1,1\n',
    )
    writeFileSync(
      join(root, 'Game', 'entry-003.bin'),
      'costumeTypes\nCostumeName,CostumeID,OwnerHero,IsCrossover\nViking,3,Viking,FALSE\n',
    )

    let fetchCalls = 0
    const fetcher: typeof fetch = Object.assign(
      async () => {
        fetchCalls++
        return new Response(JSON.stringify(officialResponse()), { status: 200 })
      },
      { preconnect: () => {} },
    )
    await expect(refreshGeneratedData(root, fetcher, outputDir)).rejects.toThrow('legend heroId contains duplicate 3')
    expect(fetchCalls).toBe(1)
    for (const path of generatedPaths) expect(readFileSync(path, 'utf8')).toBe('sentinel')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('official crossover fetch', () => {
  test('posts the exact GraphQL request to the official CMS', async () => {
    let requestUrl = ''
    let requestInit: RequestInit | undefined
    const fetcher: typeof fetch = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        requestUrl = String(input)
        requestInit = init
        return new Response(JSON.stringify(officialResponse(officialNode)), { status: 200 })
      },
      { preconnect: () => {} },
    )

    await fetchOfficialCrossovers(fetcher)

    expect(requestUrl).toBe('https://cms.brawlhalla.com/graphql')
    expect(requestInit).toEqual({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: OFFICIAL_CROSSOVER_QUERY }),
    })
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      query: `{
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
}`,
    })
  })

  test('classifies a non-OK CMS response as a request failure', async () => {
    const fetcher: typeof fetch = Object.assign(async () => new Response('unavailable', { status: 503 }), {
      preconnect: () => {},
    })

    await expect(fetchOfficialCrossovers(fetcher)).rejects.toThrow('official crossover request failed with 503')
  })
})

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

  test('sorts out-of-order costume input after joining a reviewed alias', () => {
    expect(buildSkinCatalog([costumes[1], costumes[0]], legends, roster(), { Cena: 'john-cena' })).toEqual([
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
