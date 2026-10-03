import ts from "typescript";

function scriptKind(fileName: string): ts.ScriptKind {
  if (/\.tsx$/.test(fileName)) return ts.ScriptKind.TSX;
  return ts.ScriptKind.TS;
}

function blank(text: string, start: number, end: number): string {
  const middle = text.slice(start, end).replace(/[^\r\n]/g, " ");
  return text.slice(0, start) + middle + text.slice(end);
}

function isPrivate(m: ts.ClassElement): boolean {
  const mods = ts.canHaveModifiers(m) ? ts.getModifiers(m) : undefined;
  if (mods?.some((x) => x.kind === ts.SyntaxKind.PrivateKeyword)) return true;
  const name = (m as { name?: ts.Node }).name;
  return name !== undefined && ts.isPrivateIdentifier(name);
}

/**
 * TypeScript compares classes with private or protected members nominally, so the old and new
 * declaration of the very same class are never assignable to each other. That is irrelevant to
 * consumers: private members are not API, and protected ones only matter by name and type.
 *
 * So before comparing we blank out private members and make protected ones public. Offsets are
 * preserved (replaced with spaces), so diagnostics still point at the right place.
 */
export function neutralizeNominal(fileName: string, text: string): string {
  if (!/\b(private|protected)\b|#\w/.test(text)) return text;
  const sf = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    false,
    scriptKind(fileName),
  );
  const spans: Array<[number, number]> = [];

  const visit = (node: ts.Node): void => {
    if (ts.isClassLike(node)) {
      for (const m of node.members) {
        if (ts.isConstructorDeclaration(m)) {
          for (const p of m.parameters) {
            for (const mod of ts.getModifiers(p) ?? []) {
              if (
                mod.kind === ts.SyntaxKind.PrivateKeyword ||
                mod.kind === ts.SyntaxKind.ProtectedKeyword
              ) {
                spans.push([mod.getStart(sf), mod.end]);
              }
            }
          }
          continue;
        }
        if (isPrivate(m)) {
          spans.push([m.getStart(sf), m.end]);
          continue;
        }
        const mods = ts.canHaveModifiers(m) ? ts.getModifiers(m) : undefined;
        for (const mod of mods ?? []) {
          if (mod.kind === ts.SyntaxKind.ProtectedKeyword) spans.push([mod.getStart(sf), mod.end]);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  let out = text;
  for (const [s, e] of spans) out = blank(out, s, e);
  return out;
}
