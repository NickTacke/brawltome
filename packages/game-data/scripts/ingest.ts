#!/usr/bin/env bun
// Regenerates packages/game-data/src/generated/* from the locally-extracted SWZ dumps.
// Prereq: research/swz-extract/out/ populated (see research/swz-extract/extract.ts).

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CollisionLine, Hurtbox, ItemSpawn, Legend, LevelGeometry, LevelMeta, Power } from '../src/types'

const EXTRACT_ROOT = join(import.meta.dir, '..', '..', '..', 'research', 'swz-extract', 'out')
const OUT_DIR = join(import.meta.dir, '..', 'src', 'generated')

if (!existsSync(EXTRACT_ROOT)) {
  console.error(`SWZ extracts not found at ${EXTRACT_ROOT}.`)
  process.exit(1)
}

function findXmlEntry(dir: string, sniff: string): string {
  const manifest = JSON.parse(readFileSync(join(EXTRACT_ROOT, dir, '_manifest.json'), 'utf8')) as {
    i: number
    sniff: string
  }[]
  const row = manifest.find((m) => m.sniff === sniff)
  if (!row) throw new Error(`no entry with sniff=${sniff} in ${dir}`)
  const pad = String(row.i).padStart(3, '0')
  return join(EXTRACT_ROOT, dir, `entry-${pad}.xml`)
}

function findCsvByLabel(dir: string, label: string): string {
  const manifest = JSON.parse(readFileSync(join(EXTRACT_ROOT, dir, '_manifest.json'), 'utf8')) as {
    i: number
    sniff: string
  }[]
  for (const m of manifest) {
    if (m.sniff !== 'binary') continue
    const pad = String(m.i).padStart(3, '0')
    const path = join(EXTRACT_ROOT, dir, `entry-${pad}.bin`)
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
// BMG's numeric-array columns are comma-separated per hitbox slot. Each
// entry can itself contain `&`-separated charge-level variants (e.g.
// "43.5&48,58&39,45&39" = three slots, each with two charge levels) or
// `~`-separated time-interpolated variants (e.g. "45~56" = ramp from 45
// to 56 across the phase). We flatten both by taking the first numeric
// token in each comma-separated slot, which picks the "primary" or
// uncharged value consistent with how we index into these arrays from
// castTime phases. Empty cells yield an empty array, not [0].
const colNumArray = (r: string[], i: number): number[] => {
  const v = r[i]
  if (!v) return []
  return v.split(',').map((tok) => {
    const firstPart = tok.split(/[&~]/)[0] ?? ''
    const n = Number(firstPart)
    return Number.isFinite(n) ? n : 0
  })
}

function loadLegends(): Legend[] {
  const xml = readFileSync(findXmlEntry('Game', 'HeroTypes'), 'utf8')
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

function loadLevels(): LevelMeta[] {
  const xml = readFileSync(findXmlEntry('Init', 'LevelTypes'), 'utf8')
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

function loadPowers(): Power[] {
  const { header, rows } = parseBmgCsv(findCsvByLabel('Game', 'powerTypes'))
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
    centerOffsetX: idx('CenterOffsetX'),
    centerOffsetY: idx('CenterOffsetY'),
    impulseOffsetX: idx('ImpulseOffsetX'),
    impulseOffsetY: idx('ImpulseOffsetY'),
    diMaxAngle: idx('DIMaxAngle'),
    ignoreStrength: idx('IgnoreStrength'),
    lockTo45Degrees: idx('LockTo45Degrees'),
    postHitDamageMultiplier: idx('PostHitDamageMultiplier'),
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
      baseDamage: colNumArray(r, c.baseDamage),
      variableImpulse: colNumArray(r, c.variableImpulse),
      fixedImpulse: colNumArray(r, c.fixedImpulse),
      minimumImpulse: colNumArray(r, c.minimumImpulse),
      castTime: col(r, c.castTime),
      fixedRecoverTime: col(r, c.fixedRecoverTime),
      recoverTime: col(r, c.recoverTime),
      fixedStunTime: colNum(r, c.fixedStunTime),
      cooldownTime: colNum(r, c.cooldownTime),
      onHitCooldownTime: colNum(r, c.onHitCooldownTime),
      aoeRadiusX: colNumArray(r, c.aoeRadiusX),
      aoeRadiusY: colNumArray(r, c.aoeRadiusY),
      centerOffsetX: colNumArray(r, c.centerOffsetX),
      centerOffsetY: colNumArray(r, c.centerOffsetY),
      impulseOffsetX: colNumArray(r, c.impulseOffsetX),
      impulseOffsetY: colNumArray(r, c.impulseOffsetY),
      diMaxAngle: colNum(r, c.diMaxAngle),
      ignoreStrength: colBool(r, c.ignoreStrength),
      lockTo45Degrees: colBool(r, c.lockTo45Degrees),
      postHitDamageMultiplier: colNumArray(r, c.postHitDamageMultiplier),
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

// Top-level element extractor for LevelDesc. Unlike extractRecords, it collects
// every occurrence of `tag` (including self-closed) as its attribute map; nested
// children are returned as separate records from their own call.
function extractElements(xml: string, tag: string): Map<string, string>[] {
  const pattern = new RegExp(`<${tag}(\\s[^>]*?)?(?:/>|>)`, 'g')
  const results: Map<string, string>[] = []
  for (const match of xml.matchAll(pattern)) {
    const attrs = new Map<string, string>()
    if (match[1]) {
      for (const a of match[1].matchAll(/(\w+)="([^"]*)"/g)) attrs.set(a[1], a[2])
    }
    results.push(attrs)
  }
  return results
}

const attrNum = (r: Map<string, string>, k: string, fallback = 0): number => {
  const v = r.get(k)
  if (v === undefined || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// Inner text of the first `<tag>...</tag>` in the XML, or null if absent.
// Stops at the first non-'<' run; Kill tags only contain a number.
function textElement(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))
  return m ? m[1] : null
}

function collisionsFrom(xml: string, tag: string, kind: CollisionLine['kind']): CollisionLine[] {
  return extractElements(xml, tag).map((a) => {
    // Lines are stored as (X1, X2, Y) for horizontal or (X, Y1, Y2) for vertical.
    const x = a.get('X')
    const y = a.get('Y')
    if (x !== undefined) {
      const xn = Number(x)
      return { kind, x1: xn, x2: xn, y1: attrNum(a, 'Y1'), y2: attrNum(a, 'Y2') }
    }
    if (y !== undefined) {
      const yn = Number(y)
      return { kind, x1: attrNum(a, 'X1'), x2: attrNum(a, 'X2'), y1: yn, y2: yn }
    }
    return {
      kind,
      x1: attrNum(a, 'X1'),
      x2: attrNum(a, 'X2'),
      y1: attrNum(a, 'Y1'),
      y2: attrNum(a, 'Y2'),
    }
  })
}

function loadLevelGeometry(): Record<string, LevelGeometry> {
  const manifest = JSON.parse(readFileSync(join(EXTRACT_ROOT, 'Dynamic', '_manifest.json'), 'utf8')) as {
    i: number
    sniff: string
  }[]
  const out: Record<string, LevelGeometry> = {}
  for (const e of manifest) {
    if (e.sniff !== 'LevelDesc') continue
    const pad = String(e.i).padStart(3, '0')
    const xml = readFileSync(join(EXTRACT_ROOT, 'Dynamic', `entry-${pad}.xml`), 'utf8')

    const rootMatch = xml.match(/<LevelDesc\s+([^>]*)>/)
    if (!rootMatch) continue
    const rootAttrs = new Map<string, string>()
    for (const a of rootMatch[1].matchAll(/(\w+)="([^"]*)"/g)) rootAttrs.set(a[1], a[2])
    const levelName = rootAttrs.get('LevelName') ?? ''
    if (!levelName) continue

    const cameraEls = extractElements(xml, 'CameraBounds')
    const cameraBounds = cameraEls[0]
      ? {
          x: attrNum(cameraEls[0], 'X'),
          y: attrNum(cameraEls[0], 'Y'),
          w: attrNum(cameraEls[0], 'W'),
          h: attrNum(cameraEls[0], 'H'),
        }
      : null

    const spawnBotEls = extractElements(xml, 'SpawnBotBounds')
    const spawnBotBounds = spawnBotEls[0]
      ? {
          x: attrNum(spawnBotEls[0], 'X'),
          y: attrNum(spawnBotEls[0], 'Y'),
          w: attrNum(spawnBotEls[0], 'W'),
          h: attrNum(spawnBotEls[0], 'H'),
        }
      : null

    // Kill tags are expansions from the camera bounds, stored as element text
    // (`<LeftKill>500</LeftKill>`), not attributes. Most levels omit them and
    // rely on engine defaults; the values below are observed on levels that
    // do declare them (e.g. Atlas_3v3). Without CameraBounds we cannot compute
    // an absolute position, so we leave killBounds null in that case.
    const killOffset = (tag: string, fallback: number): number => {
      const text = textElement(xml, tag)
      if (text === null) return fallback
      const n = Number(text)
      return Number.isFinite(n) ? n : fallback
    }
    const killLeft = killOffset('LeftKill', 500)
    const killRight = killOffset('RightKill', 500)
    const killTop = killOffset('TopKill', 500)
    const killBottom = killOffset('BottomKill', 300)
    const killBounds = cameraBounds
      ? {
          left: cameraBounds.x - killLeft,
          right: cameraBounds.x + cameraBounds.w + killRight,
          top: cameraBounds.y - killTop,
          bottom: cameraBounds.y + cameraBounds.h + killBottom,
        }
      : { left: null, right: null, top: null, bottom: null }

    out[levelName] = {
      levelName,
      assetDir: rootAttrs.get('AssetDir') ?? '',
      cameraBounds,
      spawnBotBounds,
      killBounds,
      respawns: extractElements(xml, 'Respawn').map((a) => ({
        x: attrNum(a, 'X'),
        y: attrNum(a, 'Y'),
      })),
      itemSpawns: [
        ...extractElements(xml, 'ItemInitSpawn').map<ItemSpawn>((a) => ({
          kind: 'init',
          x: attrNum(a, 'X'),
          y: attrNum(a, 'Y'),
          w: 0,
          h: 0,
        })),
        ...extractElements(xml, 'TeamItemInitSpawn').map<ItemSpawn>((a) => ({
          kind: 'teamInit',
          x: attrNum(a, 'X'),
          y: attrNum(a, 'Y'),
          w: 0,
          h: 0,
        })),
        ...extractElements(xml, 'ItemSpawn').map<ItemSpawn>((a) => ({
          kind: 'rolling',
          x: attrNum(a, 'X'),
          y: attrNum(a, 'Y'),
          w: attrNum(a, 'W'),
          h: attrNum(a, 'H'),
        })),
      ],
      collisions: [
        ...collisionsFrom(xml, 'HardCollision', 'hard'),
        ...collisionsFrom(xml, 'SoftCollision', 'soft'),
        ...collisionsFrom(xml, 'NoSlideCollision', 'no_slide'),
        ...collisionsFrom(xml, 'BouncyHardCollision', 'bouncy_hard'),
        ...collisionsFrom(xml, 'BouncyNoSlideCollision', 'bouncy_no_slide'),
      ],
    }
  }
  return out
}

function loadHurtboxes(): Hurtbox[] {
  const { header, rows } = parseBmgCsv(findCsvByLabel('Game', 'hurtboxTypes'))
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
    offsetX: idx('OffsetX'),
    offsetY: idx('OffsetY'),
    frames: idx('Frames'),
  }
  return rows
    .filter((r) => r[c.name] && r[c.name] !== 'Template')
    .map((r) => ({
      hurtboxName: col(r, c.name),
      hurtboxId: colNum(r, c.id),
      animClass: col(r, c.animClass),
      animName: col(r, c.animName),
      width: colNumArray(r, c.width),
      height: colNumArray(r, c.height),
      offsetX: colNumArray(r, c.offsetX),
      offsetY: colNumArray(r, c.offsetY),
      frames: col(r, c.frames),
    }))
}

function emit<T>(name: string, values: T[], typeName: string) {
  // Cast through a second constant so TS doesn't infer an enormous tuple type
  // and hit "union too complex" on 3000+ rows.
  const body = `// @generated by packages/game-data/scripts/ingest.ts - do not edit.\nimport type { ${typeName} } from '../types'\n\nconst data = ${JSON.stringify(values, null, 2)} as const\n\nexport const ${name}: readonly ${typeName}[] = data as unknown as readonly ${typeName}[]\n`
  writeFileSync(join(OUT_DIR, `${name}.ts`), body)
  console.log(`wrote ${name}.ts  (${values.length} rows)`)
}

function emitMeta(patch: string) {
  const body = `// @generated by packages/game-data/scripts/ingest.ts - do not edit.\nexport const GAME_DATA_PATCH_VERSION = '${patch}'\nexport const GAME_DATA_GENERATED_AT = '${new Date().toISOString()}'\n`
  writeFileSync(join(OUT_DIR, 'meta.ts'), body)
  console.log(`wrote meta.ts  (patch=${patch})`)
}

const patch = process.env.GAME_DATA_PATCH_VERSION ?? process.argv[2] ?? 'unknown'
emit('legends', loadLegends(), 'Legend')
emit('levels', loadLevels(), 'LevelMeta')
emit('powers', loadPowers(), 'Power')
emit('hurtboxes', loadHurtboxes(), 'Hurtbox')

const geometry = loadLevelGeometry()
const geoBody = `// @generated by packages/game-data/scripts/ingest.ts - do not edit.\nimport type { LevelGeometry } from '../types'\n\nconst data = ${JSON.stringify(geometry, null, 2)} as const\n\nexport const levelGeometry: Readonly<Record<string, LevelGeometry>> = data as unknown as Readonly<Record<string, LevelGeometry>>\n`
writeFileSync(join(OUT_DIR, 'level-geometry.ts'), geoBody)
console.log(`wrote level-geometry.ts  (${Object.keys(geometry).length} levels)`)

emitMeta(patch)
console.log('done.')
