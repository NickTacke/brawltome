import { type SQL, sql } from 'drizzle-orm'

/** A last_error value with only a code and a message, which is how reservation failures have always been stored. */
export function reservationFailure(code: string, message: string): SQL {
  return sql`${JSON.stringify({ code, message })}::text::jsonb`
}

export const reservationExpiredFailure = reservationFailure(
  'admission_reservation_expired',
  'Admission reservation expired',
)

/** The columns that end an awaiting_admission operation in dead letter and release its reservation. */
export function deadLetterReservation(lastError: SQL) {
  return {
    status: 'dead_letter' as const,
    reservationToken: null,
    reservationExpiresAt: null,
    completedAt: sql`clock_timestamp()`,
    updatedAt: sql`clock_timestamp()`,
    lastError,
  }
}
