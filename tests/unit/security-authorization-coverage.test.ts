import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const apiFiles = sourceFiles("src/app/api");
const responseRiskFixtures = sourceFiles("tests/fixtures/security-authorization");

function canContain403(type: ts.Type): boolean {
  if (type.isUnion()) return type.types.some(canContain403);
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Number)) return true;
  if (type.isNumberLiteral()) return type.value === 403;
  return false;
}

function responseFactoryOwner(
  checker: ts.TypeChecker,
  expression: ts.Expression,
): "Response" | "NextResponse" | null {
  let symbol = checker.getSymbolAtLocation(expression);
  if (!symbol) return null;
  if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const name = symbol.getName();
  return name === "Response" || name === "NextResponse" ? name : null;
}

function staticPropertyName(name: ts.PropertyName | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) {
    return name.expression.text;
  }
  return null;
}

function responseJsonOwner(checker: ts.TypeChecker, expression: ts.Expression) {
  if (ts.isPropertyAccessExpression(expression) && expression.name.text === "json") {
    return responseFactoryOwner(checker, expression.expression);
  }
  if (
    ts.isElementAccessExpression(expression)
    && expression.argumentExpression
    && ts.isStringLiteralLike(expression.argumentExpression)
    && expression.argumentExpression.text === "json"
  ) {
    return responseFactoryOwner(checker, expression.expression);
  }
  return null;
}

function unsafeResponseStatus(
  checker: ts.TypeChecker,
  init: ts.Expression | undefined,
): boolean {
  if (!init) return false;
  if (!ts.isObjectLiteralExpression(init)) return true;
  if (init.properties.some(ts.isSpreadAssignment)) return true;
  if (init.properties.some((property) => property.name && ts.isComputedPropertyName(property.name) && staticPropertyName(property.name) === null)) {
    return true;
  }
  const status = init.properties.find((property) => staticPropertyName(property.name) === "status");
  if (!status) return false;
  if (ts.isPropertyAssignment(status)) {
    if (ts.isNumericLiteral(status.initializer)) return Number(status.initializer.text) === 403;
    return canContain403(checker.getTypeAtLocation(status.initializer));
  }
  if (ts.isShorthandPropertyAssignment(status)) {
    return canContain403(checker.getTypeAtLocation(status.name));
  }
  return true;
}

let cachedRawResponse403Risks: string[] | null = null;

function rawResponse403Risks(): string[] {
  if (cachedRawResponse403Risks) return cachedRawResponse403Risks;
  const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
  const fixturePaths = responseRiskFixtures.map((path) => resolve(path));
  const program = ts.createProgram([...new Set([...parsed.fileNames, ...fixturePaths])], parsed.options);
  const checker = program.getTypeChecker();
  const risks: string[] = [];
  const scannedPaths = new Set([
    ...sourceFiles("src").filter((path) => path !== "src/lib/security-events.ts"),
    ...responseRiskFixtures,
  ].map((path) => resolve(path)));

  for (const source of program.getSourceFiles()) {
    const relative = source.fileName.slice(process.cwd().length + 1);
    if (!scannedPaths.has(resolve(source.fileName))) continue;
    const visit = (node: ts.Node): void => {
      let risky = false;
      if (ts.isCallExpression(node)) {
        const owner = responseJsonOwner(checker, node.expression);
        if (owner) risky = unsafeResponseStatus(checker, node.arguments[1]);
      } else if (ts.isNewExpression(node)) {
        const owner = responseFactoryOwner(checker, node.expression);
        if (owner) risky = unsafeResponseStatus(checker, node.arguments?.[1]);
      }
      if (risky) {
        const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
        risks.push(`${relative}:${line + 1}:${character + 1}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  cachedRawResponse403Risks = risks;
  return cachedRawResponse403Risks;
}

describe("authorization-denial audit coverage", () => {
  it("does not allow raw response factories whose status can be 403", () => {
    expect(rawResponse403Risks().filter((risk) => risk.startsWith("src/"))).toEqual([]);
  }, 20_000);

  it("catches quoted, computed, and element-access response 403 bypasses", () => {
    const fixtureRisks = rawResponse403Risks().filter((risk) => risk.startsWith("tests/fixtures/security-authorization/"));
    expect(fixtureRisks).toHaveLength(5);
    expect(new Set(fixtureRisks.map((risk) => risk.split(":")[0]))).toEqual(new Set(responseRiskFixtures));
  });

  it("requires every API containing an internal 403 result to use the explicit actor helper", () => {
    const uncovered = apiFiles.filter((file) => {
      const source = readFileSync(file, "utf8");
      return /status:\s*403/.test(source) && !source.includes("authorizationDenied(");
    });
    expect(uncovered).toEqual([]);
  });

  it("keeps non-response 403 helpers on a small documented list", () => {
    const allowedResultHelpers = new Set([
      // Pure access decision objects; API callers convert failures with their session actor.
      "src/lib/customer-workflow/access.ts",
      // Transaction/service result objects; leads routes audit at the final HTTP boundary.
      "src/lib/customer-workflow/service.ts",
      // The one function allowed to construct the marked HTTP 403 response.
      "src/lib/security-events.ts",
    ]);
    const files = sourceFiles("src/lib").filter((file) => /status:\s*403/.test(readFileSync(file, "utf8")));
    expect(files.filter((file) => !allowedResultHelpers.has(file))).toEqual([]);
  });

  it("forbids implicit request-global actor state", () => {
    const source = readFileSync("src/lib/security-events.ts", "utf8");
    expect(source).not.toMatch(/AsyncLocalStorage|enterWith|NextResponse[^\n]*\.json\s*=/);
  });

  it("requires production AuthorizationError constructors to carry an actor", () => {
    const productionFiles = sourceFiles("src");
    const uncovered = productionFiles.filter((file) => {
      const source = readFileSync(file, "utf8");
      return /new AuthorizationError\([^,)]*\)/.test(source);
    });
    expect(uncovered).toEqual([]);
  });

  it("audits every server-page AuthorizationError boundary explicitly", () => {
    const pageFiles = sourceFiles("src/app").filter((file) => file.endsWith("page.tsx"));
    const authorizationPages = pageFiles.filter((file) => readFileSync(file, "utf8").includes("AuthorizationError"));
    const uncovered = authorizationPages.filter((file) => {
      const source = readFileSync(file, "utf8");
      return !source.includes("recordSecurityEvent(") || !source.includes("error.actor");
    });
    expect(uncovered).toEqual([]);
  });
});
