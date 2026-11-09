import { FilterSelect } from '../FilterSelect'
import { regionOptions } from '../regions'
import { type BoardMode, type BoardRegion, bracketOptions } from './home-filters'

type HomeFiltersProps = {
  mode: BoardMode
  region: BoardRegion
  onMode: (mode: string) => void
  onRegion: (region: string) => void
}

// no labels, Home's section header has no room for them
export function HomeFilters({ mode, region, onMode, onRegion }: HomeFiltersProps) {
  return (
    <div className="flex gap-4">
      <FilterSelect
        label="Region"
        isIconOnly
        isLabelHidden
        value={region}
        options={regionOptions}
        onChange={onRegion}
      />
      <FilterSelect label="Bracket" isLabelHidden value={mode} options={bracketOptions} onChange={onMode} />
    </div>
  )
}
