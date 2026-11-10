import { describe, expect, test } from 'bun:test'
import type { ReactElement, ReactNode } from 'react'
import { isValidElement } from 'react'
import { SiteFooter } from '../src/components/SiteFooter'
import { getRouter } from '../src/router'

type LinkProps = { to?: string; href?: string; children?: ReactNode }

function collectLinks(node: ReactNode, links: LinkProps[] = []): LinkProps[] {
  if (Array.isArray(node)) {
    for (const child of node) collectLinks(child, links)

    return links
  }

  if (!isValidElement(node)) return links

  const { props } = node as ReactElement<LinkProps>

  if (props.to !== undefined || props.href !== undefined) links.push(props)

  return collectLinks(props.children, links)
}

const ownPaths = Object.keys(getRouter().routesByPath)

// a plain anchor to a page of this app loads the whole page again, which starts the rail over without the visitor's
// avatar and pins and makes the back button do the same
describe('links in the footer', () => {
  const links = collectLinks(SiteFooter())

  test('privacy and terms stay in the app', () => {
    const inAppPaths = links.flatMap((link) => (link.to === undefined ? [] : [link.to]))

    expect(inAppPaths).toEqual(['/privacy', '/terms'])
    for (const path of inAppPaths) expect(ownPaths).toContain(path)
  })

  test('only links that leave the site are plain anchors', () => {
    const anchorTargets = links.flatMap((link) => (link.href === undefined ? [] : [link.href]))

    expect(anchorTargets.length).toBeGreaterThan(0)
    for (const target of anchorTargets) expect(target).toStartWith('https://')
  })
})
