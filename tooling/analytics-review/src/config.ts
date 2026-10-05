import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const ENV_FILE = join(homedir(), '.config/brawltome/observability.env')
const DEFAULT_URL = 'https://observability.brawltome.app'

function passwordFromFile(readFile: (path: string) => string): string | undefined {
  let text: string
  try {
    text = readFile(ENV_FILE)
  } catch {
    return undefined
  }
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*(?:export\s+)?GRAFANA_ADMIN_PASSWORD\s*=\s*(.*?)\s*$/)
    if (match) return match[1].replace(/^(["'])(.*)\1$/, '$2') || undefined
  }
  return undefined
}

export function resolveGrafanaConfig(
  env: Record<string, string | undefined>,
  readFile: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): { baseUrl: string; password: string } {
  const password = env.GRAFANA_ADMIN_PASSWORD?.trim() || passwordFromFile(readFile)
  if (!password) {
    throw new Error(
      `Grafana password not found: set GRAFANA_ADMIN_PASSWORD in the environment or add it to ${ENV_FILE}`,
    )
  }
  return { baseUrl: env.GRAFANA_URL?.trim() || DEFAULT_URL, password }
}
