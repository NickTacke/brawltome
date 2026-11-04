import ts from 'typescript'

export interface SchemaReference {
  schema: string
  line: number
}

// finds `<schema>.<name>` inside string and template literals; comments, template
// substitutions and plain typescript (`players.length`) are code, not sql
export function findSchemaReferences(source: string, schemas: readonly string[]): SchemaReference[] {
  if (schemas.length === 0) return []

  const sourceFile = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const pattern = referencePattern(schemas)
  const references: SchemaReference[] = []

  function visit(node: ts.Node) {
    if (isLiteralPart(node) && !isModuleSpecifier(node)) {
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

// './statistics.router' is a file path, not a reference to a schema
function isModuleSpecifier(node: ts.Node): boolean {
  const parent = node.parent
  if (!parent) return false

  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return parent.moduleSpecifier === node
  if (ts.isExternalModuleReference(parent)) return true
  if (ts.isLiteralTypeNode(parent)) return ts.isImportTypeNode(parent.parent)
  if (!ts.isCallExpression(parent) || parent.arguments[0] !== node) return false

  const isDynamicImport = parent.expression.kind === ts.SyntaxKind.ImportKeyword
  const isRequire = ts.isIdentifier(parent.expression) && parent.expression.text === 'require'
  return isDynamicImport || isRequire
}

function referencePattern(schemas: readonly string[]): RegExp {
  // not preceded by a word character or a dot, so `all_players.x` and `public.players.x` do not match
  return new RegExp(`(?<![\\w.])(${schemas.join('|')})\\.(?=[A-Za-z_])`, 'g')
}

// keeps offsets and line breaks intact so reported lines stay true to the source
function blankSqlComments(text: string): string {
  const blank = (comment: string) => comment.replace(/[^\n]/g, ' ')

  return text.replace(/--[^\n]*/g, blank).replace(/\/\*[\s\S]*?\*\//g, blank)
}
