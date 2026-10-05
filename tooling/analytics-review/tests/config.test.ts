import { describe, expect, test } from 'bun:test'
import { resolveGrafanaConfig } from '../src/config'

const file = (text: string | null) => () => {
  if (text === null) throw new Error('ENOENT')
  return text
}

describe('resolveGrafanaConfig', () => {
  test('prefers the environment over the env file', () => {
    const config = resolveGrafanaConfig(
      { GRAFANA_ADMIN_PASSWORD: 'from-env', GRAFANA_URL: 'https://env.example' },
      file('GRAFANA_ADMIN_PASSWORD=from-file\n'),
    )
    expect(config).toEqual({ baseUrl: 'https://env.example', password: 'from-env' })
  })

  test('falls back to the env file, handling export and quotes', () => {
    const config = resolveGrafanaConfig({}, file('export GRAFANA_ADMIN_PASSWORD="from-file"\n'))
    expect(config).toEqual({ baseUrl: 'https://observability.brawltome.app', password: 'from-file' })
  })

  test('throws a one-line error naming both options without leaking values', () => {
    let message = ''
    try {
      resolveGrafanaConfig({}, file(null))
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('GRAFANA_ADMIN_PASSWORD')
    expect(message).toContain('observability.env')
    expect(message).not.toContain('\n')
  })
})
