import { History } from 'lucide-react'
import { fixEncoding } from '../../lib'
import { HoverReveal } from './HoverReveal'

export function AliasesButton({ aliases }: { aliases: string[] }) {
  if (aliases.length === 0) return null

  const names = aliases.map(fixEncoding).sort((left, right) => left.localeCompare(right))

  const trigger = (
    <>
      Aliases
      <History className="size-4" aria-hidden="true" />
    </>
  )

  return (
    <HoverReveal
      label={`Other names: ${names.join(', ')}`}
      trigger={trigger}
      triggerClassName="text-soft transition-colors group-hover/reveal:text-strong focus-visible:text-strong"
    >
      <ul className="max-h-52 w-max max-w-64 overflow-y-auto">
        {names.map((name) => (
          <li key={name} className="truncate rounded-sm px-2 py-1.5 text-sm font-medium whitespace-nowrap text-text">
            {name}
          </li>
        ))}
      </ul>
    </HoverReveal>
  )
}
