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
      const start = node.getStart(sourceFile) + 1
      const sql = blankSqlComments(source.slice(start, node.end - closingDelimiterLength(node)))

      for (const match of sql.matchAll(pattern)) {
        const position = start + (match.index ?? 0)
        const line = sourceFile.getLineAndCharacterOfPosition(position).line + 1
        references.push({ schema: match[1] ?? match[2], line })
      }
      return
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return references
}

// the text between the delimiters is what sql sees: quotes or backticks, and `${` or `}` around substitutions
function closingDelimiterLength(node: ts.Node): number {
  return ts.isTemplateHead(node) || ts.isTemplateMiddle(node) ? 2 : 1
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
  const names = schemas.join('|')

  // the schema is matched as written, bare or double-quoted
  // not preceded by a word character or a dot, so `all_players.x` and `public.players.x` do not match
  return new RegExp(`(?<![\\w.])(?:"(${names})"|(${names}))\\.(?=["A-Za-z_])`, 'g')
}

interface SqlToken {
  text: string
  isComment: boolean
}

// blanks comments only; keeps offsets and line breaks so reported lines stay true to the source
function blankSqlComments(sql: string): string {
  let result = ''
  let index = 0

  while (index < sql.length) {
    const token = readSqlToken(sql, index)
    result += token.isComment ? token.text.replace(/[^\n]/g, ' ') : token.text
    index += token.text.length
  }

  return result
}

// strings and quoted identifiers are read whole, so a `--` inside them does not start a comment
function readSqlToken(sql: string, start: number): SqlToken {
  const character = sql[start]

  if (sql.startsWith('--', start)) {
    const lineEnd = sql.indexOf('\n', start)
    return { text: sql.slice(start, lineEnd === -1 ? sql.length : lineEnd), isComment: true }
  }

  if (sql.startsWith('/*', start)) {
    const commentEnd = sql.indexOf('*/', start + 2)
    return { text: sql.slice(start, commentEnd === -1 ? sql.length : commentEnd + 2), isComment: true }
  }

  if (character === "'" || character === '"') {
    return { text: sql.slice(start, quotedEnd(sql, start, character)), isComment: false }
  }

  return { text: character, isComment: false }
}

// a doubled quote inside the quotes is an escaped quote; an unterminated quote runs to the end
function quotedEnd(sql: string, start: number, quote: string): number {
  let index = start + 1

  while (index < sql.length) {
    if (sql[index] !== quote) {
      index += 1
      continue
    }
    if (sql[index + 1] !== quote) return index + 1

    index += 2
  }

  return sql.length
}
