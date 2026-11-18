import type { ReactNode } from 'react'
import { sectionTitle } from '../../player/player-styles'

/** The replay's place on the page: its heading with the replay's tools next to it, then the replay. */
export function ReplaySection({ tools, children }: { tools: ReactNode; children: ReactNode }) {
  return (
    // a container, so what sits on the stage can ask how wide the replay is
    <section aria-labelledby="replay" className="@container">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="replay" className={sectionTitle}>
          Replay
        </h2>
        {tools}
      </div>
      {children}
    </section>
  )
}
