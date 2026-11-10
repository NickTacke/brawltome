import { ChevronDown } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { pauseScrollAnchoring } from '../scroll-anchoring'

type MobileCollapseProps = {
  title: string
  titleId?: string
  titleClassName: string
  headerEnd?: ReactNode
  isHeaderEndHiddenWhenClosed?: boolean
  children: ReactNode
}

// everything is css driven below md, so the first html is already collapsed and desktop never sees a toggle
export function MobileCollapse({
  title,
  titleId,
  titleClassName,
  headerEnd,
  isHeaderEndHiddenWhenClosed = false,
  children,
}: MobileCollapseProps) {
  const [isOpen, setIsOpen] = useState(false)
  const headerEndVisibility = !isOpen && isHeaderEndHiddenWhenClosed ? 'max-md:hidden' : ''

  function toggleOpen() {
    pauseScrollAnchoring()
    setIsOpen(!isOpen)
  }

  return (
    <>
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <h2 id={titleId} className={titleClassName}>
            {title}
          </h2>
          {/* the stretched hit area makes the whole header tappable */}
          <button
            type="button"
            data-collapse-toggle
            aria-expanded={isOpen}
            aria-label={`${isOpen ? 'Hide' : 'Show'} ${title}`}
            onClick={toggleOpen}
            className="text-soft after:absolute after:inset-0 md:hidden"
          >
            <ChevronDown
              aria-hidden="true"
              className={`size-5 transition-transform duration-300 ease-out motion-reduce:transition-none ${isOpen ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
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
