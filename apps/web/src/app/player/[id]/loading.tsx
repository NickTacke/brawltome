export default function PlayerLoading() {
  return (
    // biome-ignore lint/a11y/useSemanticElements: role="status" with aria-live is the conventional non-form loading pattern; <output> is for form result values.
    <div className="flex flex-col items-center justify-center py-16" role="status" aria-live="polite">
      <div className="animate-pulse text-muted-foreground" aria-hidden="true">
        Loading...
      </div>
      <span className="sr-only">Loading player profile</span>
    </div>
  )
}
