const sql = `CREATE TABLE request_admission.actor_reservations (
  reservation_key text PRIMARY KEY,
  admitted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);`

export const addActorReservations = {
  identity: 'request-admission/0002',
  predecessor: 'request-admission/0001',
  checksum: 'dc0ce038a0793f9f61a08f3fd6faba4385a3721910798ec266cc7a94b7666e37',
  sql,
} as const
