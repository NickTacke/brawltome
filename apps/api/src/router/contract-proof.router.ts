import { type ContractProof, contractProofSchema, createContractProof } from '@brawltome/contracts'
import { createInternalProcedure, router } from '../trpc/trpc'

export function createContractProofRouter(
  produce: () => ContractProof = createContractProof,
  expectedSecret = process.env.INTERNAL_API_SECRET ?? '',
) {
  return router({
    get: createInternalProcedure(expectedSecret)
      .output(contractProofSchema)
      .query(() => produce()),
  })
}

export const contractProofRouter = createContractProofRouter()
