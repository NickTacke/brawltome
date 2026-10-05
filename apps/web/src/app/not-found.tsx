import { TrackDeadEnd } from '@/components/TrackDeadEnd'
import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-4 text-center">
      <TrackDeadEnd kind="404" />
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="text-sm text-muted-foreground">We couldn&apos;t find the page you were looking for.</p>
      <Link href="/" className="text-sm underline hover:text-foreground transition-colors">
        Back to home
      </Link>
    </main>
  )
}
