import { SearchBox } from '../search/SearchBox'

export function HomeHero() {
  return (
    <div className="flex flex-col items-center">
      <h1 className="sr-only">BrawlTome</h1>
      <img data-search-dim src="/images/logo.png" alt="" width={224} height={224} className="size-44 sm:size-56" />
      <SearchBox />
    </div>
  )
}
