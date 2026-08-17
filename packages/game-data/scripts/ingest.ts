#!/usr/bin/env bun
// Regenerates packages/game-data/src/generated/* from locally-extracted SWZ dumps.
// Prereq: BRAWLTOME_SWZ_EXTRACT_ROOT points to a complete extract directory.

import { constants, accessSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { crossoverAliases } from '../src/crossover-aliases'
import type { Hurtbox, Legend, LevelMeta, Power, Skin } from '../src/types'
import { buildSkinCatalog, fetchOfficialCrossovers, parseCostumeSources } from './skin-catalog'

const OUT_DIR = join(import.meta.dir, '..', 'src', 'generated')
const EXTRACT_ERROR =
  'BRAWLTOME_SWZ_EXTRACT_ROOT must be an absolute directory containing Game/_manifest.json and Init/_manifest.json'

export function resolveExtractRoot(input: string | undefined): string {
  if (!input || input.trim() === '' || !isAbsolute(input)) throw new Error(EXTRACT_ERROR)
  try {
    if (!statSync(input).isDirectory()) throw new Error(EXTRACT_ERROR)
    accessSync(join(input, 'Game', '_manifest.json'), constants.R_OK)
    accessSync(join(input, 'Init', '_manifest.json'), constants.R_OK)
  } catch {
    throw new Error(EXTRACT_ERROR)
  }
  return input
}

function readManifest(extractRoot: string, dir: string): { i: number; sniff: string }[] {
  try {
    return JSON.parse(readFileSync(join(extractRoot, dir, '_manifest.json'), 'utf8'))
  } catch (error) {
    throw new Error(`failed to read ${dir}/_manifest.json`, { cause: error })
  }
}

function findXmlEntry(extractRoot: string, dir: string, sniff: string): string {
  const manifest = readManifest(extractRoot, dir)
  const row = manifest.find((m) => m.sniff === sniff)
  if (!row) throw new Error(`no entry with sniff=${sniff} in ${dir}`)
  const pad = String(row.i).padStart(3, '0')
  return join(extractRoot, dir, `entry-${pad}.xml`)
}

function findCsvByLabel(extractRoot: string, dir: string, label: string): string {
  const manifest = readManifest(extractRoot, dir)
  for (const m of manifest) {
    if (m.sniff !== 'binary') continue
    const pad = String(m.i).padStart(3, '0')
    const path = join(extractRoot, dir, `entry-${pad}.bin`)
    const first = readFileSync(path, 'utf8').split('\n', 1)[0].trim()
    if (first === label) return path
  }
  throw new Error(`no CSV with label=${label} in ${dir}`)
}

// Flat BMG XML: <Type attr="x">...<Field>value</Field>...</Type>.
// Extract each top-level Type record as a Map of {fieldName -> text}.
// No XML entity decoding (&amp;, &lt;, ...); BMG doesn't ship them today.
// Revisit if a regeneration ever surfaces literal `&...;` in a generated value.
function extractRecords(xml: string, tag: string): Map<string, string>[] {
  const open = new RegExp(`<${tag}\\s+[^>]*>`, 'g')
  const records: Map<string, string>[] = []
  let match: RegExpExecArray | null = open.exec(xml)
  while (match) {
    const start = match.index + match[0].length
    const closeIdx = xml.indexOf(`</${tag}>`, start)
    if (closeIdx === -1) break
    const body = xml.slice(start, closeIdx)

    const attrsOpen = match[0].slice(tag.length + 1, -1)
    const record = new Map<string, string>()
    for (const a of attrsOpen.matchAll(/(\w+)="([^"]*)"/g)) record.set(a[1], a[2])

    let depth = 0
    let tagName = ''
    let tagStart = -1
    for (let i = 0; i < body.length; i++) {
      const ch = body[i]
      if (ch !== '<') continue
      if (body[i + 1] === '/') {
        if (depth === 1 && tagName) {
          const valEnd = body.indexOf('<', tagStart)
          const value = body.slice(tagStart, valEnd).trim()
          if (!record.has(tagName)) record.set(tagName, value)
        }
        depth--
        tagName = ''
        i = body.indexOf('>', i)
      } else if (body[i + 1] === '!') {
        i = body.indexOf('-->', i) + 2
      } else {
        depth++
        if (depth === 1) {
          const gt = body.indexOf('>', i)
          const inner = body.slice(i + 1, gt)
          const nameEnd = inner.search(/[\s/>]/)
          tagName = inner.slice(0, nameEnd === -1 ? inner.length : nameEnd)
          const selfClose = body[gt - 1] === '/'
          tagStart = gt + 1
          if (selfClose) {
            depth--
            tagName = ''
          }
          i = gt
        }
      }
    }
    records.push(record)
    match = open.exec(xml)
  }
  return records
}

const str = (r: Map<string, string>, k: string): string | null => {
  const v = r.get(k)
  return v === undefined || v === '' || v === '--' || v === '---' ? null : v
}
const numv = (r: Map<string, string>, k: string, fallback = 0): number => {
  const v = str(r, k)
  if (v === null) return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
const boolv = (r: Map<string, string>, k: string): boolean => {
  const v = r.get(k)
  return v === 'TRUE' || v === 'True' || v === 'true' || v === '1'
}

function parseCsv(raw: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuote = false
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (inQuote) {
      if (c === '"') {
        if (raw[i + 1] === '"') {
          cell += '"'
          i++
        } else inQuote = false
      } else cell += c
    } else if (c === '"') inQuote = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (c !== '\r') cell += c
  }
  if (cell.length || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

function parseBmgCsv(path: string): { header: string[]; rows: string[][] } {
  const rows = parseCsv(readFileSync(path, 'utf8'))
  return { header: rows[1] ?? [], rows: rows.slice(2).filter((r) => r.some((c) => c !== '')) }
}

const col = (r: string[], i: number): string => r[i] ?? ''
const colNum = (r: string[], i: number, f = 0): number => {
  const v = r[i]
  if (!v) return f
  const n = Number(v)
  return Number.isFinite(n) ? n : f
}
const colBool = (r: string[], i: number): boolean => {
  const v = r[i]
  return v === 'TRUE' || v === 'True' || v === 'true' || v === '1'
}

function loadLegends(extractRoot: string): Legend[] {
  const xml = readFileSync(findXmlEntry(extractRoot, 'Game', 'HeroTypes'), 'utf8')
  // Inactive/beta heroes (e.g. DEFAULT_CHARACTER, Random) stay in knownHeroIds
  // so historical replays referencing them don't bounce at Layer 2 validation.
  return extractRecords(xml, 'HeroType')
    .filter((r) => r.get('HeroName') && r.get('HeroName') !== 'Template')
    .map((r) => ({
      heroId: numv(r, 'HeroID'),
      heroName: r.get('HeroName') ?? '',
      displayName: str(r, 'HeroDisplayName') ?? '',
      strength: numv(r, 'Strength'),
      dexterity: numv(r, 'Dexterity'),
      weight: numv(r, 'Weight'),
      speed: numv(r, 'Speed'),
      weaponOne: str(r, 'BaseWeapon1') ?? '',
      weaponTwo: str(r, 'BaseWeapon2') ?? '',
      isActive: boolv(r, 'IsActive'),
      isBeta: boolv(r, 'IsBeta'),
    }))
}

function loadLevels(extractRoot: string): LevelMeta[] {
  const xml = readFileSync(findXmlEntry(extractRoot, 'Init', 'LevelTypes'), 'utf8')
  return extractRecords(xml, 'LevelType')
    .filter((r) => r.get('LevelName') && r.get('LevelName') !== 'Template')
    .map((r) => ({
      levelId: numv(r, 'LevelID'),
      levelName: r.get('LevelName') ?? '',
      displayName: str(r, 'DisplayName') ?? '',
      devOnly: boolv(r, 'DevOnly'),
      testLevel: boolv(r, 'TestLevel'),
      fileName: str(r, 'FileName'),
    }))
}

function loadPowers(extractRoot: string): Power[] {
  const { header, rows } = parseBmgCsv(findCsvByLabel(extractRoot, 'Game', 'powerTypes'))
  const idx = (n: string) => {
    const i = header.indexOf(n)
    if (i === -1) throw new Error(`powerTypes: column ${n} not found in header`)
    return i
  }
  const c = {
    powerName: idx('PowerName'),
    powerId: idx('PowerID'),
    baseDamage: idx('BaseDamage'),
    variableImpulse: idx('VariableImpulse'),
    fixedImpulse: idx('FixedImpulse'),
    minimumImpulse: idx('MinimumImpulse'),
    castTime: idx('CastTime'),
    fixedRecoverTime: idx('FixedRecoverTime'),
    recoverTime: idx('RecoverTime'),
    fixedStunTime: idx('FixedStunTime'),
    cooldownTime: idx('CooldownTime'),
    onHitCooldownTime: idx('OnHitCooldownTime'),
    aoeRadiusX: idx('AoERadiusX'),
    aoeRadiusY: idx('AoERadiusY'),
    isAirPower: idx('IsAirPower'),
    isSignature: idx('IsSignature'),
    isAntiair: idx('IsAntiair'),
    isMultihit: idx('IsMultihit'),
    endOnHit: idx('EndOnHit'),
    cancelGravity: idx('CancelGravity'),
    wallCancel: idx('WallCancel'),
    hurtbox: idx('Hurtbox'),
  }
  return rows
    .filter((r) => r[c.powerName] && r[c.powerName] !== 'Template')
    .map((r) => ({
      powerId: colNum(r, c.powerId),
      powerName: col(r, c.powerName),
      baseDamage: colNum(r, c.baseDamage),
      variableImpulse: colNum(r, c.variableImpulse),
      fixedImpulse: colNum(r, c.fixedImpulse),
      minimumImpulse: colNum(r, c.minimumImpulse),
      castTime: col(r, c.castTime),
      fixedRecoverTime: col(r, c.fixedRecoverTime),
      recoverTime: col(r, c.recoverTime),
      fixedStunTime: colNum(r, c.fixedStunTime),
      cooldownTime: colNum(r, c.cooldownTime),
      onHitCooldownTime: colNum(r, c.onHitCooldownTime),
      aoeRadiusX: colNum(r, c.aoeRadiusX),
      aoeRadiusY: colNum(r, c.aoeRadiusY),
      isAirPower: colBool(r, c.isAirPower),
      isSignature: colBool(r, c.isSignature),
      isAntiair: colBool(r, c.isAntiair),
      isMultihit: colBool(r, c.isMultihit),
      endOnHit: colBool(r, c.endOnHit),
      cancelGravity: colBool(r, c.cancelGravity),
      wallCancel: colBool(r, c.wallCancel),
      hurtboxName: col(r, c.hurtbox) || null,
    }))
}

function loadHurtboxes(extractRoot: string): Hurtbox[] {
  const { header, rows } = parseBmgCsv(findCsvByLabel(extractRoot, 'Game', 'hurtboxTypes'))
  const idx = (n: string) => {
    const i = header.indexOf(n)
    if (i === -1) throw new Error(`hurtboxTypes: column ${n} not found in header`)
    return i
  }
  const c = {
    name: idx('HurtboxName'),
    id: idx('HurtboxID'),
    animClass: idx('AnimClass'),
    animName: idx('AnimName'),
    width: idx('Width'),
    height: idx('Height'),
  }
  return rows
    .filter((r) => r[c.name] && r[c.name] !== 'Template')
    .map((r) => ({
      hurtboxName: col(r, c.name),
      hurtboxId: colNum(r, c.id),
      animClass: col(r, c.animClass),
      animName: col(r, c.animName),
      width: colNum(r, c.width),
      height: colNum(r, c.height),
    }))
}

export type GeneratedData = {
  legends: Legend[]
  levels: LevelMeta[]
  powers: Power[]
  hurtboxes: Hurtbox[]
  skins: Skin[]
}

const assertRows = (name: string, rows: readonly unknown[]): void => {
  if (rows.length === 0) throw new Error(`${name} generated no rows`)
}

const assertUnique = (name: string, values: readonly (string | number)[]): void => {
  const seen = new Set<string | number>()
  for (const value of values) {
    if (seen.has(value)) throw new Error(`${name} contains duplicate ${value}`)
    seen.add(value)
  }
}

export function validateGeneratedData(data: GeneratedData): void {
  assertRows('legends', data.legends)
  assertRows('levels', data.levels)
  assertRows('powers', data.powers)
  assertRows('hurtboxes', data.hurtboxes)
  assertRows('skins', data.skins)
  assertUnique(
    'legend heroId',
    data.legends.map(({ heroId }) => heroId),
  )
  assertUnique(
    'legend heroName',
    data.legends.map(({ heroName }) => heroName),
  )
  assertUnique(
    'level levelId',
    data.levels.map(({ levelId }) => levelId),
  )
  assertUnique(
    'power powerId',
    data.powers.map(({ powerId }) => powerId),
  )
  assertUnique(
    'hurtbox hurtboxId',
    data.hurtboxes.map(({ hurtboxId }) => hurtboxId),
  )
  assertUnique(
    'hurtbox hurtboxName',
    data.hurtboxes.map(({ hurtboxName }) => hurtboxName),
  )
  assertUnique(
    'skin skinId',
    data.skins.map(({ skinId }) => skinId),
  )

  const requiredRow = (dataset: string, id: number, name: string): void => {
    if (!Number.isSafeInteger(id) || id < 0 || name.trim() === '') {
      throw new Error(`${dataset} contains invalid id/name ${id}/${JSON.stringify(name)}`)
    }
  }
  for (const row of data.legends) requiredRow('legends', row.heroId, row.heroName)
  for (const row of data.levels) requiredRow('levels', row.levelId, row.levelName)
  for (const row of data.powers) requiredRow('powers', row.powerId, row.powerName)
  for (const row of data.hurtboxes) requiredRow('hurtboxes', row.hurtboxId, row.hurtboxName)
  for (const row of data.skins) requiredRow('skins', row.skinId, row.skinName)

  const legendIds = new Set(data.legends.map(({ heroId }) => heroId))
  for (const skin of data.skins) {
    if (!legendIds.has(skin.legendId)) throw new Error(`skin ${skin.skinId} references unknown legend ${skin.legendId}`)
    if (skin.isCrossover !== Boolean(skin.displayName && skin.imageUrl)) {
      throw new Error(`skin ${skin.skinId} has inconsistent crossover metadata`)
    }
  }
}

async function loadSkins(extractRoot: string, legends: readonly Legend[], fetcher: typeof fetch): Promise<Skin[]> {
  const { header, rows } = parseBmgCsv(findCsvByLabel(extractRoot, 'Game', 'costumeTypes'))
  const roster = await fetchOfficialCrossovers(fetcher)
  return buildSkinCatalog(parseCostumeSources([header, ...rows]), legends, roster, crossoverAliases)
}

function emit<T>(outputDir: string, name: string, values: readonly T[], typeName: string) {
  // Cast through a second constant so TS doesn't infer an enormous tuple type
  // and hit "union too complex" on 3000+ rows.
  const body = `// @generated by packages/game-data/scripts/ingest.ts - do not edit.\nimport type { ${typeName} } from '../types'\n\nconst data = ${JSON.stringify(values, null, 2)} as const\n\nexport const ${name}: readonly ${typeName}[] = data as unknown as readonly ${typeName}[]\n`
  writeFileSync(join(outputDir, `${name}.ts`), body)
  console.log(`wrote ${name}.ts  (${values.length} rows)`)
}

export async function refreshGeneratedData(
  extractRoot: string,
  fetcher: typeof fetch = fetch,
  outputDir: string = OUT_DIR,
): Promise<void> {
  const legends = loadLegends(extractRoot)
  const generated: GeneratedData = {
    legends,
    levels: loadLevels(extractRoot),
    powers: loadPowers(extractRoot),
    hurtboxes: loadHurtboxes(extractRoot),
    skins: await loadSkins(extractRoot, legends, fetcher),
  }

  validateGeneratedData(generated)
  emit(outputDir, 'legends', generated.legends, 'Legend')
  emit(outputDir, 'levels', generated.levels, 'LevelMeta')
  emit(outputDir, 'powers', generated.powers, 'Power')
  emit(outputDir, 'hurtboxes', generated.hurtboxes, 'Hurtbox')
  emit(outputDir, 'skins', generated.skins, 'Skin')
  console.log('done.')
}

if (import.meta.main) {
  await refreshGeneratedData(resolveExtractRoot(process.env.BRAWLTOME_SWZ_EXTRACT_ROOT))
}
