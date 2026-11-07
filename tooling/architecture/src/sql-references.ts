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

  function collect(sql: string, offset: number) {
    for (const match of blankSqlComments(sql).matchAll(pattern)) {
      const position = offset + (match.index ?? 0)
      const line = sourceFile.getLineAndCharacterOfPosition(position).line + 1

      references.push({ schema: match[1] ?? match[2], line })
    }
  }

  function visit(node: ts.Node) {
    if (ts.isTemplateExpression(node)) {
      collect(templateSql(node, source, sourceFile), node.getStart(sourceFile) + 1)
      // a substitution is code, but it may hold a literal of its own
      for (const span of node.templateSpans) visit(span.expression)

      return
    }

    if (isPlainLiteral(node) && !isModuleSpecifier(node)) {
      // the text between the quotes or backticks is what sql sees
      collect(source.slice(node.getStart(sourceFile) + 1, node.end - 1), node.getStart(sourceFile) + 1)

      return
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return references
}

// the whole template as one text, so quote and comment state carries across substitutions;
// each `${...}` becomes spaces of the same length, newlines kept so lines stay true
function templateSql(template: ts.TemplateExpression, source: string, sourceFile: ts.SourceFile): string {
  const textStart = template.getStart(sourceFile) + 1
  let sql = source.slice(textStart, template.end - 1)

  for (const [index, span] of template.templateSpans.entries()) {
    const previousLiteral = index === 0 ? template.head : template.templateSpans[index - 1].literal
    const substitutionStart = previousLiteral.end - 2 - textStart
    const substitutionEnd = span.literal.getStart(sourceFile) + 1 - textStart
    const blanked = sql.slice(substitutionStart, substitutionEnd).replace(/[^\n]/g, ' ')

    sql = sql.slice(0, substitutionStart) + blanked + sql.slice(substitutionEnd)
  }

  return sql
}

function isPlainLiteral(node: ts.Node): boolean {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
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
