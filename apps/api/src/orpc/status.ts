import { apiStatusSchema } from '@brawltome/contracts'
import { procedure } from './context'

// the API's own liveness answer, so it belongs to no module
export const status = procedure
  .route({
    method: 'GET',
    path: '/status',
    operationId: 'status',
    summary: 'API status',
    tags: ['status'],
  })
  .output(apiStatusSchema)
  .handler(() => ({ status: 'ready' as const }))
