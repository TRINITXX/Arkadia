import type { SFSymbol } from "sf-symbols-typescript";

const ICON_OF_TOOL: Record<string, SFSymbol> = {
  Read: "doc.text",
  Edit: "pencil",
  MultiEdit: "pencil",
  Write: "square.and.pencil",
  Bash: "terminal",
  Grep: "magnifyingglass",
  Glob: "magnifyingglass",
  LS: "folder",
  WebFetch: "globe",
  WebSearch: "globe",
  Task: "person.2",
  Agent: "person.2",
  TodoWrite: "checklist",
};

export function toolIcon(name: string | undefined): SFSymbol {
  return (name && ICON_OF_TOOL[name]) || "wrench.and.screwdriver";
}

/** The file's last segment, whichever slash the PC used. */
function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * One line saying what a tool call did, from its compact JSON input: the
 * file, the command, the pattern or the address it worked on.
 */
export function toolSummary(input: string | undefined): string {
  if (!input) return "";
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(input) as Record<string, unknown>;
  } catch {
    return input.slice(0, 80);
  }
  const pick = (key: string) =>
    typeof args[key] === "string" ? (args[key] as string) : null;
  const file = pick("file_path") ?? pick("notebook_path") ?? pick("path");
  if (file) return fileName(file);
  const line =
    pick("description") ??
    pick("command") ??
    pick("pattern") ??
    pick("url") ??
    pick("query") ??
    pick("prompt");
  return (line ?? "").split("\n")[0].slice(0, 80);
}
