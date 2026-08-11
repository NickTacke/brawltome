import { type CareerWeaponUsageInputContract, careerWeaponUsageInputSchema } from '@brawltome/contracts'

export type CareerWeaponUsageSearchParams = Record<string, string | string[] | undefined>

export function parseCareerWeaponUsageFilters(
  searchParams: CareerWeaponUsageSearchParams,
): CareerWeaponUsageInputContract {
  const parsed = careerWeaponUsageInputSchema.safeParse({
    region: searchParams.region,
    bracket: searchParams.bracket,
  })
  return parsed.success ? parsed.data : { region: 'all', bracket: 'all' }
}
