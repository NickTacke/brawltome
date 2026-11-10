import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compile } from 'tailwindcss'

const sourceRoot = join(import.meta.dir, '../src')
const tailwindStylesheet = Bun.resolveSync('tailwindcss/index.css', import.meta.dir)
// the design is 1920 wide on any magnified 16:9 screen, however many real px that screen has
const widestDesignPx = 1920
const browserFontSizePx = 16

async function compileClasses(classNames: string[]): Promise<string> {
  const stylesheet = readFileSync(join(sourceRoot, 'styles.css'), 'utf8')

  const compiler = await compile(stylesheet, {
    base: sourceRoot,
    loadStylesheet: async (_id, base) => ({
      path: tailwindStylesheet,
      base,
      content: readFileSync(tailwindStylesheet, 'utf8'),
    }),
  })

  return compiler.build(classNames)
}

function sourceFiles(): string[] {
  const entries = readdirSync(sourceRoot, { recursive: true, encoding: 'utf8' })

  return entries.filter((entry) => /\.tsx?$/.test(entry)).map((entry) => join(sourceRoot, entry))
}

function breakpointsPastTheDesign(path: string): string[] {
  const breakpoints = readFileSync(path, 'utf8').matchAll(/min-\[(\d+(?:\.\d+)?)(px|rem)\]:/g)

  return [...breakpoints]
    .filter(([, size, unit]) => Number(size) * (unit === 'rem' ? browserFontSizePx : 1) > widestDesignPx)
    .map(([breakpoint]) => `${path}: ${breakpoint}`)
}

describe('ultrawide variant', () => {
  test('applies from 2200 wide on a window at least 2.2 times as wide as it is high', async () => {
    const css = await compileClasses(['ultrawide:hidden'])

    expect(css).toContain('@media (min-width: 137.5rem) and (min-aspect-ratio: 11 / 5)')
  })

  test('comes after the widest breakpoint, so it wins over it', async () => {
    const css = await compileClasses(['ultrawide:w-8', '2xl:w-4'])

    expect(css.indexOf('ultrawide')).toBeGreaterThan(css.indexOf('2xl'))
  })

  test('is the only way to style past the 1920 design, a wider breakpoint would read the real screen', () => {
    expect(sourceFiles().flatMap(breakpointsPastTheDesign)).toEqual([])
  })
})
