import { initializeRequestAdmission } from './migrations/0001-initialize-admission'
import { addActorReservations } from './migrations/0002-add-actor-reservations'

export { createPostgresRequestAdmission, type PostgresRequestAdmission } from './postgres'

export const requestAdmissionMigrationInventory = [initializeRequestAdmission, addActorReservations] as const
