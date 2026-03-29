import { useState } from 'react'
import { OverlayPanel } from './components/OverlayPanel'
import type { Opponent } from './types'

const MOCK_OPPONENTS: Opponent[] = [
  {
    brawlhallaId: 2836298,
    name: 'Sandstorm',
    rating: 2487,
    peakRating: 2512,
    playtime: 4231.5,
    tier: 'Diamond',
    region: 'US-E',
  },
]

export default function App() {
  const [opponents] = useState<Opponent[]>(MOCK_OPPONENTS)

  return (
    <div className="flex h-screen items-start justify-end p-4 pt-20">
      <OverlayPanel opponents={opponents} visible={true} />
    </div>
  )
}
