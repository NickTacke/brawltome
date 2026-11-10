import { useRouter } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { useEffect } from 'react'
import { legendAvatarUrl } from '../guild/legend-avatar-url'
import { PlayerLink } from '../guild/PlayerLink'
import { type PinnedPlayerRow, playerLabel, type Verification } from './account-model'

// the worker usually checks steam within seconds; past a minute a reload is fine
const pendingCheckEveryMs = 3_000
const longestPendingCheckMs = 60_000

const buttonStyle =
  'mt-3 inline-flex h-9 items-center rounded-control bg-white/[0.08] px-4 text-sm font-semibold text-strong transition-colors hover:bg-white/[0.12]'

// like the old account page, which asked again every two seconds while the check ran
function useReloadWhilePending(isPending: boolean) {
  const router = useRouter()

  useEffect(() => {
    if (!isPending) return

    const startedAt = Date.now()

    const timer = setInterval(() => {
      if (Date.now() - startedAt > longestPendingCheckMs) {
        clearInterval(timer)

        return
      }

      void router.invalidate()
    }, pendingCheckEveryMs)

    return () => clearInterval(timer)
  }, [isPending, router])
}

function VerifiedPlayer({ player }: { player: PinnedPlayerRow }) {
  return (
    <div className="mt-3 flex items-center gap-3">
      <img
        src={legendAvatarUrl(player.legendNameKey)}
        alt=""
        className="size-14 shrink-0 rounded-lg bg-raised object-cover object-top"
      />
      <div className="min-w-0">
        <PlayerLink
          playerId={player.brawlhallaId}
          className="block truncate text-lg font-bold text-strong transition-colors hover:text-primary"
        >
          {playerLabel(player)}
        </PlayerLink>
        <div className="flex items-center gap-1.5 text-sm text-soft">
          <Check className="size-4 text-emerald-400" aria-hidden="true" /> Verified through Steam
        </div>
      </div>
    </div>
  )
}

const unverifiedText: Record<'unverified' | 'failed' | 'conflict', string> = {
  unverified: 'Verify through Steam to link your Brawlhalla account. It stays at the top of your pinned players.',
  failed: 'Steam found no Brawlhalla account for that Steam account.',
  conflict: 'Another BrawlTome account already verified this Brawlhalla account.',
}

type VerificationStateProps = { verification: Verification; verifySteamUrl: string }

function VerificationState({ verification, verifySteamUrl }: VerificationStateProps) {
  if (verification.status === 'verified') return <VerifiedPlayer player={verification.player} />

  if (verification.status === 'pending') return <p className="mt-2 text-soft">Verifying your account…</p>

  return (
    <>
      <p className="mt-2 text-soft">{unverifiedText[verification.status]}</p>
      {/* steam verification runs on the api, like sign-in */}
      <a href={verifySteamUrl} className={buttonStyle}>
        {verification.status === 'unverified' ? 'Verify with Steam' : 'Try again'}
      </a>
    </>
  )
}

type YourAccountProps = VerificationStateProps & { errorMessage: string | null }

export function YourAccount({ verification, verifySteamUrl, errorMessage }: YourAccountProps) {
  useReloadWhilePending(verification.status === 'pending')

  return (
    <>
      {errorMessage && (
        <p role="alert" className="mt-2 text-sm font-medium text-red-400">
          {errorMessage}
        </p>
      )}
      <VerificationState verification={verification} verifySteamUrl={verifySteamUrl} />
    </>
  )
}
