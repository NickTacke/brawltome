#!/usr/bin/env bun
// Regenerates packages/game-data/src/generated/* from the locally-extracted SWZ dumps.
// Prereq: research/swz-extract/out/ populated (see research/swz-extract/extract.ts).

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Hurtbox, Legend, LevelMeta, Power } from '../src/types'

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

function loadLegends(): Legend[] {
  const xml = readFileSync(findXmlEntry('Game', 'HeroTypes'), 'utf8')
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
  const { rows } = parseBmgCsv(findCsvByLabel('Game', 'powerTypes'))
  return rows
    .filter((r) => r[0] && r[0] !== 'Template')
    .map((r) => ({
      powerId: colNum(r, 1),
      powerName: col(r, 0),
      baseDamage: colNum(r, 66),
      variableImpulse: colNum(r, 67),
      fixedImpulse: colNum(r, 68),
      minimumImpulse: colNum(r, 69),
      castTime: col(r, 49),
      fixedRecoverTime: col(r, 50),
      recoverTime: col(r, 51),
      fixedStunTime: colNum(r, 99),
      cooldownTime: colNum(r, 56),
      onHitCooldownTime: colNum(r, 58),
      aoeRadiusX: colNum(r, 16),
      aoeRadiusY: colNum(r, 17),
      isAirPower: colBool(r, 12),
      isSignature: colBool(r, 13),
      isAntiair: colBool(r, 14),
      isMultihit: colBool(r, 92),
      endOnHit: colBool(r, 32),
      cancelGravity: colBool(r, 33),
      wallCancel: colBool(r, 34),
      hurtboxName: col(r, 48) || null,
    }))
}

function loadHurtboxes(): Hurtbox[] {
  const { header, rows } = parseBmgCsv(findCsvByLabel('Game', 'hurtboxTypes'))
  const idx = (n: string) => header.indexOf(n)
  const nameIdx = idx('HurtboxName')
  const idIdx = idx('HurtboxID')
  const animClassIdx = idx('AnimClass')
  const animNameIdx = idx('AnimName')
  const widthIdx = idx('Width')
  const heightIdx = idx('Height')
  return rows
    .filter((r) => r[nameIdx] && r[nameIdx] !== 'Template')
    .map((r) => ({
      hurtboxName: col(r, nameIdx),
      hurtboxId: colNum(r, idIdx),
      animClass: col(r, animClassIdx),
      animName: col(r, animNameIdx),
      width: colNum(r, widthIdx),
      height: colNum(r, heightIdx),
    }))
}

function emit<T>(name: string, values: T[], typeName: string) {
  // Cast through a second constant so TS doesn't infer an enormous tuple type
  // and hit "union too complex" on 3000+ rows.
  const body = `// @generated by packages/game-data/scripts/ingest.ts - do not edit.\nimport type { ${typeName} } from '../types'\n\nconst data = ${JSON.stringify(values, null, 2)} as const\n\nexport const ${name}: readonly ${typeName}[] = data as unknown as readonly ${typeName}[]\n`
  writeFileSync(join(OUT_DIR, `${name}.ts`), body)
  console.log(`wrote ${name}.ts  (${values.length} rows)`)
}

emit('legends', loadLegends(), 'Legend')
emit('levels', loadLevels(), 'LevelMeta')
emit('powers', loadPowers(), 'Power')
emit('hurtboxes', loadHurtboxes(), 'Hurtbox')
console.log('done.')
