import { describe, expect, test } from 'bun:test'
import { Card, CardContent, CardHeader, CardTitle } from '@brawltome/ui'
import { renderToStaticMarkup } from 'react-dom/server'

describe('Card public contract', () => {
  test('renders the existing primitive through the package root', () => {
    const html = renderToStaticMarkup(
      <Card id="summary" aria-label="Player summary" className="p-2 shadow-none">
        <CardHeader>
          <CardTitle>Player</CardTitle>
        </CardHeader>
        <CardContent>Stats</CardContent>
      </Card>,
    )

    expect(html).toContain('id="summary"')
    expect(html).toContain('aria-label="Player summary"')
    expect(html).toContain('rounded-lg border bg-card text-card-foreground p-2 shadow-none')
    expect(html).not.toContain('shadow-xs')
    expect(html).toContain('<h3 class="text-2xl font-semibold leading-none tracking-tight">Player</h3>')
    expect(html).toContain('<div class="p-6 pt-0">Stats</div>')
  })
})
