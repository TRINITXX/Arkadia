import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

interface MetroConfig {
  resolver: { sourceExts: string[]; assetExts: string[] };
}

const ROOT = path.resolve(__dirname, "../../..");
const IPHONE = path.join(ROOT, "iphone");
/** The tsconfig's paths of the app (`iphone/tsconfig.json`). */
const ALIASES: [string, string][] = [
  ["@/", path.join(ROOT, "src")],
  ["@chat-server/", path.join(ROOT, "chat-server")],
  ["~/", path.join(IPHONE, "src")],
];
const EXTS = ["", ".ts", ".tsx", ".js", "/index.ts", "/index.tsx"];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return sources(file);
    return /\.tsx?$/.test(name) ? [file] : [];
  });
}

/** The modules a file loads at run time: type-only imports are erased. */
function runtimeImports(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
  );
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const typesOnly =
        clause !== undefined &&
        (clause.isTypeOnly ||
          (!clause.name &&
            named !== undefined &&
            ts.isNamedImports(named) &&
            named.elements.length > 0 &&
            named.elements.every((e) => e.isTypeOnly)));
      if (!typesOnly) found.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      found.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** A source file for an import, or null: a package (or a `?raw` text). */
function resolve(from: string, name: string): string | null {
  const clean = name.replace(/\?raw$/, "");
  const alias = ALIASES.find(([prefix]) => clean.startsWith(prefix));
  const base = alias
    ? path.join(alias[1], clean.slice(alias[0].length))
    : clean.startsWith(".")
      ? path.resolve(path.dirname(from), clean)
      : null;
  if (base === null) return null;
  for (const ext of EXTS) {
    const file = base + ext;
    if (existsSync(file) && statSync(file).isFile())
      return /\.tsx?$/.test(file) ? file : null;
  }
  return null;
}

describe("the iPhone app's Metro config", () => {
  // A `?raw` file (the visuals' shell) resolved as an asset gave
  // `chatVisual` an asset's id for its text: it threw at load, and the app
  // closed at a chat's first open (02/11/2026).
  it("reads .html as source text, never as an asset", () => {
    const config = require("../../../iphone/metro.config.js") as MetroConfig;
    expect(config.resolver.sourceExts).toContain("html");
    expect(config.resolver.assetExts).not.toContain("html");
  });

  // Metro resolves a shared file's packages from the app's node_modules
  // alone: `accounts.ts` importing the credits' constants from `credits.ts`
  // (Tauri) broke the whole bundle (13/11/2026).
  it("reaches no Tauri module from the app's code", () => {
    const from = new Map<string, string>();
    const queue = sources(path.join(IPHONE, "src"));
    for (const file of queue) from.set(file, "");
    const bad: string[] = [];
    while (queue.length > 0) {
      const file = queue.pop()!;
      for (const name of runtimeImports(file)) {
        if (name.startsWith("@tauri-apps/")) {
          const chain = [file];
          while (from.get(chain[0])) chain.unshift(from.get(chain[0])!);
          bad.push(
            `${chain.map((f) => path.relative(ROOT, f).replaceAll("\\", "/")).join(" → ")} imports ${name}`,
          );
        }
        const next = resolve(file, name);
        if (next && !from.has(next)) {
          from.set(next, file);
          queue.push(next);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
