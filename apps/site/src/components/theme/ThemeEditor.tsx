import { themeWarning } from './theme-contrast'
import type { ThemeColours } from './theme-palettes'
import type { SavedTheme } from './theme-storage'

const colourFields: Array<{ key: keyof ThemeColours; label: string }> = [
  { key: 'page', label: 'Background' },
  { key: 'accent', label: 'Accent' },
]

const maximumNameLength = 24

function ColourField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex h-10 cursor-pointer items-center justify-between gap-4 text-sm font-medium text-text">
      {label}
      <span className="flex items-center gap-2.5 font-mono text-xs text-soft uppercase">
        {value}
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="size-7 cursor-pointer overflow-hidden rounded-md border-0 bg-transparent p-0 ring-1 ring-line [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
        />
      </span>
    </label>
  )
}

type ThemeEditorProps = { theme: SavedTheme; onChange: (theme: SavedTheme) => void; onDelete: () => void }

export function ThemeEditor({ theme, onChange, onDelete }: ThemeEditorProps) {
  const warning = themeWarning(theme.colours)

  function changeColour(key: keyof ThemeColours, value: string) {
    onChange({ ...theme, colours: { ...theme.colours, [key]: value } })
  }

  return (
    <div className="mt-3">
      <div className="divide-y divide-line/30">
        <label className="flex h-10 items-center justify-between gap-4 text-sm font-medium text-text">
          Name
          <input
            value={theme.name}
            maxLength={maximumNameLength}
            onChange={(event) => onChange({ ...theme, name: event.target.value })}
            className="min-w-0 flex-1 border-b border-transparent bg-transparent py-0.5 text-right font-semibold text-strong outline-none transition-colors hover:border-line focus:border-primary"
          />
        </label>
        {colourFields.map(({ key, label }) => (
          <ColourField
            key={key}
            label={label}
            value={theme.colours[key]}
            onChange={(value) => changeColour(key, value)}
          />
        ))}
      </div>
      {warning && (
        <p role="status" className="mt-2 text-sm font-medium text-amber-400">
          {warning}
        </p>
      )}
      <button
        type="button"
        onClick={onDelete}
        className="mt-2 text-sm font-semibold text-soft transition-colors hover:text-red-400"
      >
        Delete theme
      </button>
    </div>
  )
}
