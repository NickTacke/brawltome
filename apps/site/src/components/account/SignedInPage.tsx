import { useEffect } from 'react'
import { railAccount } from '../rail/use-rail-account'
import { ThemePicker } from '../theme/ThemePicker'
import { AccountHeader } from './AccountHeader'
import type { AccountPage } from './account-model'
import { PinnedPlayers, sectionTitleStyle } from './PinnedPlayers'
import { usePins } from './use-pins'
import { YourAccount } from './YourAccount'

type SignedInPageProps = { page: Extract<AccountPage, { kind: 'signedIn' }>; errorMessage: string | null }

export function SignedInPage({ page, errorMessage }: SignedInPageProps) {
  const verifiedPlayer = page.verification.status === 'verified' ? page.verification.player : null
  const verifiedId = verifiedPlayer?.brawlhallaId ?? null
  const { pins, isBusy, hasFailed, move, unpin } = usePins(page, verifiedId)

  // the verification poll reloads this page, and the rail has to learn about a newly verified account too
  useEffect(() => {
    void railAccount.followVerification(verifiedId)
  }, [verifiedId])

  return (
    // the same two columns as the guild page: content on the left, a fixed side column on wide screens
    <div className="[--gutter:max(4rem,calc((100vw-57px-1080px-380px)/3))] md:px-10 xl:relative xl:left-1/2 xl:grid xl:w-[calc(100vw-57px)] xl:-translate-x-1/2 xl:grid-cols-[minmax(0,1fr)_380px] xl:px-(--gutter)">
      <div className="min-w-0 xl:border-r xl:border-line/50 xl:pr-(--gutter)">
        <AccountHeader account={page.account} />
        <div className="pt-6">
          <PinnedPlayers
            verifiedPlayer={verifiedPlayer}
            pins={pins}
            isBusy={isBusy}
            hasFailed={hasFailed}
            onMove={move}
            onUnpin={unpin}
          />
        </div>
      </div>
      <aside className="divide-y divide-line/50 max-xl:mt-6 max-xl:border-t max-xl:border-line/50 max-xl:pt-6 xl:pl-(--gutter) [&>*]:py-6 [&>*:first-child]:pt-0">
        <section>
          <h2 className={sectionTitleStyle}>Your account</h2>
          <YourAccount
            verification={page.verification}
            verifySteamUrl={page.verifySteamUrl}
            errorMessage={errorMessage}
          />
        </section>
        <section>
          <h2 className={sectionTitleStyle}>Theme</h2>
          <ThemePicker />
        </section>
      </aside>
    </div>
  )
}
