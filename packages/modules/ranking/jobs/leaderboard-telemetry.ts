import type { Telemetry } from '@brawltome/telemetry'

export function recordLeaderboardTelemetry(telemetry: Telemetry, write: (active: Telemetry) => void): void {
  try {
    write(telemetry)
  } catch {
    // telemetry never decides the outcome of the job
  }
}
