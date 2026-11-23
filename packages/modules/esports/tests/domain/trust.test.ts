import { describe, expect, test } from 'bun:test'
import { isTrustedLink, type LinkEvidence } from '../../domain/trust'

const noEvidence: LinkEvidence = {
  esportsName: 'Somebody',
  eventLegends: [],
  esportsRegion: null,
  accountNames: ['Another Name'],
  accountTopLegends: [],
  accountRegion: null,
}

describe('isTrustedLink', () => {
  test('trusts Marckiemoo through the alias LGN | Marckiem00', () => {
    const evidence = { ...noEvidence, esportsName: 'Marckiemoo', accountNames: ['???', 'LGN | Marckiem00'] }

    expect(isTrustedLink(evidence)).toBe(true)
  })

  test('trusts Zivai → LGN | Godly through legends and region', () => {
    const evidence: LinkEvidence = {
      esportsName: 'Zivai',
      eventLegends: ['mordex', 'teros', 'ulgrim'],
      esportsRegion: 'MENA',
      accountNames: ['LGN | Godly'],
      accountTopLegends: ['teros', 'zariel', 'mordex', 'onyx', 'cross', 'brynn', 'kaya', 'wu shang'],
      accountRegion: 'EU',
    }

    expect(isTrustedLink(evidence)).toBe(true)
  })

  test("rejects a link whose name, legends and region don't match", () => {
    const evidence: LinkEvidence = {
      esportsName: 'Zivai',
      eventLegends: ['mordex', 'teros', 'ulgrim'],
      esportsRegion: 'NA',
      accountNames: ['LGN | Godly'],
      accountTopLegends: ['teros', 'zariel', 'onyx'],
      accountRegion: 'EU',
    }

    expect(isTrustedLink(evidence)).toBe(false)
  })

  test('rejects matching legends in the wrong region', () => {
    const evidence: LinkEvidence = {
      esportsName: 'Zivai',
      eventLegends: ['mordex', 'teros', 'ulgrim'],
      esportsRegion: 'NA',
      accountNames: ['LGN | Godly'],
      accountTopLegends: ['mordex', 'teros', 'ulgrim'],
      accountRegion: 'EU',
    }

    expect(isTrustedLink(evidence)).toBe(false)
  })

  test('rejects one shared legend in the right region', () => {
    const evidence: LinkEvidence = {
      esportsName: 'Zivai',
      eventLegends: ['mordex', 'teros', 'ulgrim'],
      esportsRegion: 'EU',
      accountNames: ['LGN | Godly'],
      accountTopLegends: ['mordex', 'onyx'],
      accountRegion: 'EU',
    }

    expect(isTrustedLink(evidence)).toBe(false)
  })

  test('trusts a name one letter off', () => {
    const evidence = { ...noEvidence, esportsName: 'Diadrawz', accountNames: ['Diadraw'] }

    expect(isTrustedLink(evidence)).toBe(true)
  })

  test('never trusts a name with no letters', () => {
    const evidence = { ...noEvidence, esportsName: '1234', accountNames: ['???'] }

    expect(isTrustedLink(evidence)).toBe(false)
  })
})
