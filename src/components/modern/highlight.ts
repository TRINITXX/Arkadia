// Shared highlight.js core for the modern view: rehype-highlight uses lowlight
// (its own registration) for markdown fences; this module highlights the tool
// cards (Write content, Bash commands) directly.
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("css", css);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("go", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("powershell", powershell);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

/** Guard against pathological inputs: past this, plain text reads fine. */
const HIGHLIGHT_CAP = 20_000;

/**
 * Highlighted HTML for `code`, or `null` when the language is unknown or the
 * input too large (caller falls back to a plain <pre>). hljs escapes its
 * output, so the result is safe for `dangerouslySetInnerHTML`.
 */
export function highlightHtml(
  code: string,
  lang: string | null,
): string | null {
  if (!lang || code.length > HIGHLIGHT_CAP || !hljs.getLanguage(lang)) {
    return null;
  }
  try {
    return hljs.highlight(code, { language: lang }).value;
  } catch {
    return null;
  }
}

const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  rs: "rust",
  py: "python",
  sh: "bash",
  bash: "bash",
  ps1: "powershell",
  psm1: "powershell",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  vue: "xml",
  css: "css",
  scss: "css",
  sql: "sql",
  yml: "yaml",
  yaml: "yaml",
  toml: "yaml",
  md: "markdown",
  mdx: "markdown",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  go: "go",
  java: "java",
};

/** hljs language for a file path's extension, or `null` if unmapped. */
export function langForPath(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG[ext] ?? null;
}
