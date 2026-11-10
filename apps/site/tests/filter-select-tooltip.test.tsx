import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { FilterSelect } from '../src/components/FilterSelect'
import { IconTooltip } from '../src/components/IconTooltip'
import { regionOptions } from '../src/components/regions'

describe('region flag tooltips', () => {
  test('the icon-only trigger names the region it shows', () => {
    const html = renderToStaticMarkup(
      <FilterSelect label="Region" value="EU" options={regionOptions} isIconOnly onChange={() => undefined} />,
    )

    expect(html).toContain('data-tooltip')
    expect(html).toMatch(/data-tooltip[^>]*>Europe</)
  })

  test('a trigger with its label written out has no tooltip', () => {
    const html = renderToStaticMarkup(
      <FilterSelect label="Region" value="EU" options={regionOptions} onChange={() => undefined} />,
    )

    expect(html).not.toContain('data-tooltip')
  })

  test('the tooltip is hidden from screen readers, which get the label from aria-label', () => {
    const html = renderToStaticMarkup(<IconTooltip label="Global" />)

    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('>Global<')
  })
})
