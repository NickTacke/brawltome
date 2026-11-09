import { Plus } from 'lucide-react'
import { ThemeEditor } from './ThemeEditor'
import { MiniPage, ThemeTile } from './ThemeTile'
import { themePresets, tokensFromColours } from './theme-palettes'
import { maximumSavedThemes } from './theme-storage'
import { usePreview, useThemes } from './use-themes'

export function ThemePicker() {
  const { activeId, savedThemes, activate, createTheme, updateTheme, deleteTheme } = useThemes()
  const { preview, endPreview } = usePreview()
  const selectedSaved = savedThemes.find((theme) => theme.id === activeId)
  const defaultTokens = themePresets[0].tokens

  return (
    <div className="mt-3">
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        {themePresets.map(({ id, label, tokens }) => (
          <ThemeTile
            key={id}
            label={label}
            isSelected={activeId === id}
            onSelect={() => activate(id, tokens)}
            onPreview={() => preview(tokens)}
            onPreviewEnd={endPreview}
          >
            <MiniPage tokens={tokens} />
          </ThemeTile>
        ))}
        {savedThemes.map((theme) => (
          <ThemeTile
            key={theme.id}
            label={theme.name || 'Untitled'}
            isSelected={activeId === theme.id}
            onSelect={() => activate(theme.id, tokensFromColours(theme.colours))}
            onPreview={() => preview(tokensFromColours(theme.colours))}
            onPreviewEnd={endPreview}
          >
            <MiniPage tokens={tokensFromColours(theme.colours)} />
          </ThemeTile>
        ))}
        {savedThemes.length < maximumSavedThemes && (
          <ThemeTile label="New theme" isSelected={false} onSelect={createTheme}>
            <span className="flex aspect-[16/10] items-center justify-center rounded-md bg-raised/60 text-soft transition-colors group-hover:text-strong">
              <Plus className="size-5" aria-hidden="true" />
            </span>
          </ThemeTile>
        )}
      </div>
      {selectedSaved && (
        <ThemeEditor
          key={selectedSaved.id}
          theme={selectedSaved}
          onChange={updateTheme}
          onDelete={() => deleteTheme(selectedSaved.id, defaultTokens)}
        />
      )}
    </div>
  )
}
