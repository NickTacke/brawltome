'use client'

export function CommandFooter() {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-muted/20 text-[10px] text-muted-foreground">
      <div className="flex items-center gap-2">
        <kbd className="inline-flex items-center px-1 py-0.5 rounded border border-border font-mono">&uarr;&darr;</kbd>
        <span>navigate</span>
        <kbd className="inline-flex items-center px-1 py-0.5 rounded border border-border font-mono">&crarr;</kbd>
        <span>select</span>
      </div>
      <div className="flex items-center gap-1">
        <kbd className="inline-flex items-center px-1 py-0.5 rounded border border-border font-mono">Ctrl</kbd>
        <kbd className="inline-flex items-center px-1 py-0.5 rounded border border-border font-mono">K</kbd>
      </div>
    </div>
  )
}
