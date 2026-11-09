import { Link } from '@tanstack/react-router'

export function NotFound() {
  return (
    <div className="py-16">
      <h1 className="text-heading font-semibold">This page isn't built yet</h1>
      <p className="mt-2 text-soft">It may have moved, or it's still on the old site.</p>
      <Link to="/" reloadDocument className="mt-4 inline-block text-primary underline underline-offset-4">
        Back home
      </Link>
    </div>
  )
}
