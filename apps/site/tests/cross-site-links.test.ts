import { describe, expect, test } from 'bun:test'
import { RailLink, railItems } from '../src/components/AppRail'
import { NotFound } from '../src/components/NotFound'
import { AccountLink } from '../src/components/rail/AccountLink'
import { getRouter } from '../src/router'

type Element = { props: { to: string; reloadDocument?: boolean } }

const ownPaths = Object.keys(getRouter().routesByPath)

// a page load starts the rail over without the visitor's avatar and pins until the account is read again, so a link
// to a page of this app must not ask for one
describe('links in the rail', () => {
  test.each(railItems.map((item) => [item.to, item]))('the link to %s goes to a page of this app', (path) => {
    expect(ownPaths).toContain(path)
  })

  test.each(railItems.map((item) => [item.to, item]))('the link to %s stays in the app', (_, item) => {
    expect((RailLink(item) as unknown as Element).props.reloadDocument).toBeUndefined()
  })

  test('the account link stays in the app', () => {
    const link = AccountLink({ className: '' }) as unknown as Element

    expect(ownPaths).toContain(link.props.to)
    expect(link.props.reloadDocument).toBeUndefined()
  })
})

// a path this app doesn't know may still be a page of the old site on the same domain
describe('the not found page', () => {
  test('links home with a page load', () => {
    const page = NotFound() as unknown as { props: { children: Element[] } }
    const homeLink = page.props.children.find((child) => child?.props && 'reloadDocument' in child.props)

    expect(homeLink?.props.reloadDocument).toBe(true)
  })
})
