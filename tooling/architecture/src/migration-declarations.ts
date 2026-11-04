import ts from 'typescript'

export interface MigrationDeclaration {
  // undefined when the file holds no `identity: '<literal>'`, e.g. a helper next to the migrations
  identity: string | undefined
  requires: string[]
}

// reads the identity and requires of the migration object a file declares; only string literals count,
// since the check reads source text and doesn't run it
export function readMigrationDeclaration(source: string): MigrationDeclaration {
  const sourceFile = ts.createSourceFile('migration.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declaration: MigrationDeclaration = { identity: undefined, requires: [] }

  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      readProperty(node.name.text, node.initializer, declaration)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return declaration
}

function readProperty(name: string, initializer: ts.Expression, declaration: MigrationDeclaration) {
  const value = withoutTypeAssertion(initializer)

  if (name === 'identity' && ts.isStringLiteralLike(value)) {
    declaration.identity = value.text
  }

  if (name === 'requires' && ts.isArrayLiteralExpression(value)) {
    const identities = value.elements.filter(ts.isStringLiteralLike).map((element) => element.text)
    declaration.requires.push(...identities)
  }
}

// `['players/0001'] as const` and `satisfies` wrap the literal without changing it
function withoutTypeAssertion(expression: ts.Expression): ts.Expression {
  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return withoutTypeAssertion(expression.expression)
  }

  return expression
}
