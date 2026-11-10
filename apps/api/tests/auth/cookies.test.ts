import { describe, expect, test } from 'bun:test'
import { reissueSessionCookies } from '../../src/auth/cookies'

describe('reissueSessionCookies', () => {
  test('sets the same host-only cookie when no cookie domain is configured', () => {
    const cookies = reissueSessionCookies('raw-token', 600, undefined)

    expect(cookies).toHaveLength(1)
    expect(cookies[0]).toStartWith('brawltome_session=raw-token; Path=/; HttpOnly; SameSite=Lax; Max-Age=600')
    expect(cookies[0]).not.toContain('Domain=')
  })

  // otherwise the old host-only copy stays on the api's host beside the domain one
  test('drops the host-only copy before setting the domain cookie', () => {
    const [clearHostOnly, domainCookie] = reissueSessionCookies('raw-token', 600, 'brawltome.app')

    expect(clearHostOnly).toStartWith('brawltome_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')
    expect(clearHostOnly).not.toContain('Domain=')
    expect(domainCookie).toStartWith('brawltome_session=raw-token; Path=/; HttpOnly; SameSite=Lax; Max-Age=600')
    expect(domainCookie).toEndWith('Domain=brawltome.app')
  })
})
