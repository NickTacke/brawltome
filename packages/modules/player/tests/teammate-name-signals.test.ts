import { describe, expect, test } from 'bun:test'
import { maxTeammateNamesPerRefresh, readTeammateNames } from '../teammate-name-signals'

const ownerId = 700

const team = (brawlhallaIdOne: number, brawlhallaIdTwo: number, teamName: string) => ({
  brawlhallaIdOne,
  brawlhallaIdTwo,
  teamName,
})

const read = (fixedTeams: ReturnType<typeof team>[], name: string | null = 'Owner') =>
  readTeammateNames({ brawlhallaId: ownerId, name, fixedTeams })

describe('Teammate names in 2v2 team names', () => {
  test('gives each half to the player id on the same side', () => {
    expect(read([team(ownerId, 801, 'Owner+Second'), team(802, ownerId, 'First+Owner')])).toEqual([
      { brawlhallaId: 801, playerName: 'Second' },
      { brawlhallaId: 802, playerName: 'First' },
    ])
  })

  test('skips a team name that does not split into two halves', () => {
    expect(read([team(ownerId, 801, 'Owner'), team(ownerId, 802, 'Owner+Plus+Name'), team(ownerId, 803, '')])).toEqual(
      [],
    )
  })

  test('skips a team name whose own half is not the name the same response gives the owner', () => {
    // an older name of the owner, or the halves the other way round: neither says anything about the teammate
    expect(read([team(ownerId, 801, 'Former Owner+Second'), team(ownerId, 802, 'Second+Owner')])).toEqual([])
    expect(read([team(ownerId, 801, 'Owner+Second')], null)).toEqual([])
  })

  test('ignores spaces around either half and stores the name without them', () => {
    expect(read([team(ownerId, 801, 'Owner + Second '), team(802, ownerId, ' First+Owner')], ' Owner ')).toEqual([
      { brawlhallaId: 801, playerName: 'Second' },
      { brawlhallaId: 802, playerName: 'First' },
    ])
  })

  test('keeps a no-break space, which is half of a letter in a mojibake name', () => {
    // "à" arrives as "Ã" followed by U+00A0
    expect(read([team(ownerId, 801, 'Owner+PapÃ\u00a0')])).toEqual([{ brawlhallaId: 801, playerName: 'PapÃ\u00a0' }])
  })

  test('keeps a mojibake name as the source spelled it', () => {
    expect(read([team(ownerId, 801, 'MÃ¼ller+JosÃ©')], 'MÃ¼ller')).toEqual([{ brawlhallaId: 801, playerName: 'JosÃ©' }])
  })

  test('skips a half no player could be named', () => {
    expect(
      read([team(ownerId, 801, 'Owner+'), team(ownerId, 802, 'Owner+  '), team(ownerId, 803, 'Owner+Player 803')]),
    ).toEqual([])
  })

  test('reads at most a fixed number of teams per refresh', () => {
    const teams = Array.from({ length: maxTeammateNamesPerRefresh + 10 }, (_, index) =>
      team(ownerId, 1_000 + index, `Owner+Mate ${index}`),
    )

    expect(read(teams)).toHaveLength(maxTeammateNamesPerRefresh)
  })
})
