import { describe, expect, test } from 'bun:test'
import { RailLink, railItems } from '../src/components/AppRail'
import { NotFound } from '../src/components/NotFound'
import { AccountLink } from '../src/components/rail/AccountLink'

type Element = { props: { reloadDocument?: boolean } }

// while the old and new sites share brawltome.app, a link handled inside this app would render this app's version of a
// page the old site still serves, so links to the shared pages load the page from the server instead
describe('links to pages the old site may still serve', () => {
  test.each(railItems.map((item) => [item.to, item]))('the rail link to %s loads the page', (_, item) => {
    expect((RailLink(item) as unknown as Element).props.reloadDocument).toBe(true)
  })

  test('sign in loads the page', () => {
    expect((AccountLink({ className: '' }) as unknown as Element).props.reloadDocument).toBe(true)
  })

  test('the not found page links home with a page load', () => {
    const page = NotFound() as unknown as { props: { children: Element[] } }
    const homeLink = page.props.children.find((child) => child?.props && 'reloadDocument' in child.props)

    expect(homeLink?.props.reloadDocument).toBe(true)
  })
})
