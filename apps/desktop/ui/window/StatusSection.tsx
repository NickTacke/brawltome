import type { StatusLine } from './status-format'

type StatusSectionProps = { lines: StatusLine[]; onResume: () => void }

// one quiet line when all is well, one more for each thing that needs the player
export function StatusSection({ lines, onResume }: StatusSectionProps) {
  return (
    <section className="status-lines">
      {lines.map((line) => (
        <div className={`status-line tone-${line.tone}`} key={line.text}>
          <span className="status-text">
            <span className="status-main">{line.text}</span>
            {line.detail !== null && <small>{line.detail}</small>}
          </span>
          {line.action === 'resume' && (
            <button type="button" className="text-button" onClick={onResume}>
              Resume
            </button>
          )}
        </div>
      ))}
    </section>
  )
}
