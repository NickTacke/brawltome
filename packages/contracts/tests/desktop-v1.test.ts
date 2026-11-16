import { describe, expect, test } from 'bun:test'
import { desktopLobbyInputSchema, desktopVersionSchema, parseDesktopLobbyOutput } from '../src'
import { generateContractOpenApi } from '../src/openapi'

type OpenApiObject = { properties?: Record<string, unknown>; additionalProperties?: unknown; [key: string]: unknown }

const fixtureNames = ['1v1', '2v2', 'no-data']

async function readFixture(name: string) {
  return Bun.file(`${import.meta.dir}/fixtures/desktop-v1-lobby-${name}.json`).json()
}

// the standing may be wrapped in anyOf, oneOf or allOf for nullability
function findObjectSchema(schema: unknown): OpenApiObject | undefined {
  const candidate = schema as OpenApiObject | undefined

  if (!candidate) return undefined

  if (candidate.properties) return candidate

  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    const members = candidate[key]

    if (!Array.isArray(members)) continue

    const found = members.map(findObjectSchema).find((member) => member !== undefined)

    if (found) return found
  }

  return undefined
}

function additionalPropertiesOf(schema: unknown): unknown {
  return findObjectSchema(schema)?.additionalProperties
}

function lobbyInput(brawlhallaIds: number[]) {
  return {
    matchType: '1v1',
    players: brawlhallaIds.map((brawlhallaId, index) => ({ brawlhallaId, team: index })),
  }
}

describe('desktop v1 lobby contract', () => {
  test('parses the shared lobby fixtures unchanged', async () => {
    for (const name of fixtureNames) {
      const fixture = await readFixture(name)

      expect(parseDesktopLobbyOutput(fixture)).toEqual(fixture)
    }
  })

  test('drops a field it does not know instead of failing', async () => {
    const fixture = await readFixture('1v1')

    expect(parseDesktopLobbyOutput({ ...fixture, addedLater: true })).toEqual(fixture)
  })

  test('refuses a lobby with no players, five players or the same player twice', () => {
    expect(desktopLobbyInputSchema.safeParse(lobbyInput([])).success).toBe(false)
    expect(desktopLobbyInputSchema.safeParse(lobbyInput([1, 2, 3, 4, 5])).success).toBe(false)
    expect(desktopLobbyInputSchema.safeParse(lobbyInput([7, 7])).success).toBe(false)

    expect(desktopLobbyInputSchema.safeParse(lobbyInput([1])).success).toBe(true)
    expect(desktopLobbyInputSchema.safeParse(lobbyInput([1, 2, 3, 4])).success).toBe(true)
  })

  test('accepts 0.2.0 and 0.2.0-beta.1 as versions and refuses v0.2.0, 0.2 and 1.2.3.4', () => {
    expect(desktopVersionSchema.safeParse('0.2.0').success).toBe(true)
    expect(desktopVersionSchema.safeParse('0.2.0-beta.1').success).toBe(true)

    for (const invalid of ['v0.2.0', '0.2', '1.2.3.4']) {
      expect(desktopVersionSchema.safeParse(invalid).success).toBe(false)
    }
  })

  test('declares the lobby route with the version header and the 426 answer', () => {
    const operation = generateContractOpenApi().paths['/desktop/v1/lobby']?.post

    expect(operation).toMatchObject({
      operationId: 'postDesktopLobby',
      parameters: [{ in: 'header', name: 'x-desktop-version', required: true }],
    })

    expect(Object.keys(operation?.responses ?? {})).toEqual(['200', '426'])
  })

  test('leaves every desktop v1 object open, so generated clients accept new fields', () => {
    const schemas = generateContractOpenApi().components?.schemas ?? {}

    const names = [
      'DesktopLobby',
      'DesktopLobbyCard',
      'DesktopLobbyPlayer',
      'DesktopLobbyInput',
      'DesktopUpdateRequired',
    ]

    for (const name of names) {
      expect(schemas[name]).toBeDefined()
      expect(additionalPropertiesOf(schemas[name])).toBeUndefined()
    }

    const playerProperties = (schemas.DesktopLobbyPlayer as OpenApiObject).properties
    const cardProperties = (schemas.DesktopLobbyCard as OpenApiObject).properties

    for (const standing of [playerProperties?.oneVsOne, cardProperties?.teamStanding]) {
      expect(standing).toBeDefined()
      expect(additionalPropertiesOf(standing)).toBeUndefined()
      expect(findObjectSchema(standing)?.properties).toHaveProperty('rating')
    }
  })
})
