import { accountViewSchema } from '@brawltome/contracts'
import { toAccountView } from '../mappers/account.mapper'
import { publicProcedure, router } from '../trpc/trpc'

export const accountRouter = router({
  current: publicProcedure.output(accountViewSchema).query(({ ctx }) => toAccountView(ctx.account)),
})
