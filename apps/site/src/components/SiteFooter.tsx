import { Link } from '@tanstack/react-router'
import { socialLinks } from './social-links'
import { ThemeButton } from './theme/ThemeButton'

const footerLinkStyle = 'transition-colors hover:text-strong'

export function SiteFooter() {
  return (
    <footer className="border-t border-line/50">
      <div className="mx-auto flex w-full flex-col gap-5 px-6 py-7 md:flex-row md:items-center md:justify-between md:gap-12 md:px-16 xl:w-[min(87.5rem,calc(100vw-11.5625rem))] xl:px-0">
        <p className="text-xs leading-relaxed text-soft">
          Not associated with or endorsed by Blue Mammoth Games, who own Brawlhalla, its art and its trademarks.
        </p>
        <nav aria-label="Footer" className="flex shrink-0 items-center gap-5 text-sm font-semibold text-soft">
          <Link to="/privacy" className={footerLinkStyle}>
            Privacy
          </Link>
          <Link to="/terms" className={footerLinkStyle}>
            Terms
          </Link>
          <ThemeButton className={footerLinkStyle} />
          <span className="h-4 w-px bg-line" aria-hidden="true" />
          {socialLinks.map(({ href, label, svg }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              title={label}
              className={`${footerLinkStyle} [&>svg]:size-5`}
            >
              {svg}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  )
}
