import { createContractProof, parseContractProofOutput } from '@brawltome/contracts'
import { Hono } from 'hono'
import { internalSecretValid } from '../auth/internal-secret'

export function createContractProofRoutes(
  produce: () => unknown = createContractProof,
  expectedSecret = process.env.INTERNAL_API_SECRET,
): Hono {
  const routes = new Hono()

  routes.get('/proof', (c) => {
    if (!internalSecretValid(c.req.header('x-internal-secret'), expectedSecret)) {
      return c.json({ error: 'unauthorized' }, 401)
    }

    return c.json(parseContractProofOutput(produce()))
  })

  return routes
}
