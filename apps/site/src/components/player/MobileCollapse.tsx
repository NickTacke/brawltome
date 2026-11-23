import { ChevronDown } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { pauseScrollAnchoring } from '../scroll-anchoring'

type MobileCollapseProps = {
  title: string
  titleId?: string
  titleClassName: string
  headerEnd?: ReactNode
  isHeaderEndHiddenWhenClosed?: boolean
  // always visible, also while closed
  summary?: ReactNode
  children: ReactNode
}

type CollapseToggleProps = { title: string; isOpen: boolean; onToggle: () => void }

// the stretched hit area makes the whole header tappable
function CollapseToggle({ title, isOpen, onToggle }: CollapseToggleProps) {
  return (
    <button
      type="button"
      data-collapse-toggle
      aria-expanded={isOpen}
      aria-label={`${isOpen ? 'Hide' : 'Show'} ${title}`}
      onClick={onToggle}
      className="text-soft after:absolute after:inset-0 md:hidden"
    >
      <ChevronDown
        aria-hidden="true"
        className={`size-5 transition-transform duration-300 ease-out motion-reduce:transition-none ${isOpen ? 'rotate-180' : ''}`}
      />
    </button>
  )
}

type TitleGroupProps = Pick<MobileCollapseProps, 'title' | 'titleId' | 'titleClassName' | 'summary'> & {
  toggle: ReactNode
}

// the summary sits beside the title from md, and on a phone takes its own line under it
function TitleGroup({ title, titleId, titleClassName, summary, toggle }: TitleGroupProps) {
  const titleRow = (
    <div className="flex min-w-0 items-center gap-1.5">
      <h2 id={titleId} className={titleClassName}>
        {title}
      </h2>
      {toggle}
    </div>
  )

  if (!summary) return titleRow

  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-7 gap-y-2">
      {titleRow}
      <div className="min-w-0 max-md:basis-full">{summary}</div>
    </div>
  )
}

// everything is css driven below md, so the first html is already collapsed and desktop never sees a toggle
export function MobileCollapse({
  title,
  titleId,
  titleClassName,
  headerEnd,
  isHeaderEndHiddenWhenClosed = false,
  summary,
  children,
}: MobileCollapseProps) {
  const [isOpen, setIsOpen] = useState(false)
  const headerEndVisibility = !isOpen && isHeaderEndHiddenWhenClosed ? 'max-md:hidden' : ''
  // a summary can wrap onto more lines, and the header end stays level with the title
  const headerAlignment = summary ? 'items-start' : 'items-center'

  function toggleOpen() {
    pauseScrollAnchoring()
    setIsOpen(!isOpen)
  }

  const toggle = <CollapseToggle title={title} isOpen={isOpen} onToggle={toggleOpen} />

  return (
    <>
      <div className={`relative flex justify-between gap-3 ${headerAlignment}`}>
        <TitleGroup title={title} titleId={titleId} titleClassName={titleClassName} summary={summary} toggle={toggle} />
        {headerEnd && <div className={`relative z-10 ${headerEndVisibility}`}>{headerEnd}</div>}
      </div>
      <div
        data-collapse-body
        className={`grid grid-cols-[minmax(0,1fr)] transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none md:grid-rows-[1fr] ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div
          className={`min-h-0 overflow-hidden transition-[visibility] duration-300 md:visible md:overflow-visible ${isOpen ? '' : 'invisible'}`}
        >
          {children}
        </div>
      </div>
    </>
  )
}
