import ts from 'typescript'

export interface SchemaReference {
  schema: string
  line: number
}

// finds `<schema>.<name>` inside string and template literals; comments, template
// substitutions and plain typescript (`players.length`) are code, not sql
export function findSchemaReferences(source: string, schemas: readonly string[]): SchemaReference[] {
  if (schemas.length === 0) return []

  const sourceFile = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  const pattern = referencePattern(schemas)
  const references: SchemaReference[] = []

  function visit(node: ts.Node) {
    if (isLiteralPart(node)) {
      const start = node.getStart(sourceFile)
      const sql = blankSqlComments(source.slice(start, node.end))

      for (const match of sql.matchAll(pattern)) {
        const position = start + (match.index ?? 0)
        const line = sourceFile.getLineAndCharacterOfPosition(position).line + 1
        references.push({ schema: match[1], line })
      }
      return
    }

    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  return references
}

function isLiteralPart(node: ts.Node): boolean {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  )
}

function referencePattern(schemas: readonly string[]): RegExp {
  // not preceded by a word character, a dot or a slash, so `all_players.x`, `public.players.x`
  // and import paths such as './statistics.router' do not match
  return new RegExp(`(?<![\\w./])(${schemas.join('|')})\\.(?=[A-Za-z_])`, 'g')
}

// keeps offsets and line breaks intact so reported lines stay true to the source
function blankSqlComments(text: string): string {
  const blank = (comment: string) => comment.replace(/[^\n]/g, ' ')

  return text.replace(/--[^\n]*/g, blank).replace(/\/\*[\s\S]*?\*\//g, blank)
}
