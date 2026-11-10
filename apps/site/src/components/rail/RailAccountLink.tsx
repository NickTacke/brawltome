import { User } from '@solar-icons/react'
import { AccountLink } from './AccountLink'
import type { RailAccount } from './rail-account'
import { railTooltipLook } from './rail-tooltip'

const tooltipStyle = `absolute left-full ml-3 ${railTooltipLook}`

const squareStyle =
  'flex size-10 items-center justify-center overflow-hidden rounded-control border-2 border-rail bg-raised text-soft transition-all group-hover:brightness-150'

function AccountPicture({ avatarUrl }: { avatarUrl: string | null }) {
  if (!avatarUrl) return <User className="size-6" weight="Linear" aria-hidden="true" />

  return <img src={avatarUrl} alt="" className="size-full object-cover" />
}

/** The bottom of the rail: the sign-in icon, or the visitor's discord avatar once signed in. */
export function RailAccountLink({ account }: { account: RailAccount }) {
  const isSignedIn = account.kind === 'signedIn'
  const tooltip = isSignedIn ? account.displayName : 'Sign in'

  return (
    <AccountLink label={isSignedIn ? 'Account' : 'Sign in'} className="group relative flex size-10 items-center">
      <span className={squareStyle}>
        {isSignedIn ? (
          <AccountPicture avatarUrl={account.avatarUrl} />
        ) : (
          <User className="size-6" weight="Linear" aria-hidden="true" />
        )}
      </span>
      <span className={tooltipStyle}>{tooltip}</span>
    </AccountLink>
  )
}
