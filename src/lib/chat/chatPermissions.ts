import { toolLabel } from "@/lib/chat/chatGroups";
import { folderOf, modeLabel } from "@/lib/chat/chatLabels";
import type {
  PermissionDestination,
  PermissionRule,
  PermissionUpdate,
} from "@/lib/chat/chatProtocol";

/**
 * The terminal's « Yes, and don't ask again… » in the chat: Claude Code sends
 * each permission request with the rule changes that would stop it asking
 * (`suggestions`), and a button applies one of them with the answer.
 */

const WHERE: Record<PermissionDestination, string> = {
  localSettings: "ici",
  projectSettings: "ici",
  userSettings: "partout",
  session: "pendant cette session",
  cliArg: "pendant cette session",
};

const KEPT_IN: Record<PermissionDestination, string> = {
  localSettings: "dans .claude/settings.local.json du projet",
  projectSettings: "dans .claude/settings.json du projet",
  userSettings: "dans tes réglages de Claude Code",
  session: "pour cette session seulement",
  cliArg: "pour cette session seulement",
};

const lasting = (d: PermissionDestination) => d !== "session" && d !== "cliArg";

/** `Bash(pnpm add:*)` as a settings file writes it. */
export function ruleText(rule: PermissionRule): string {
  return rule.ruleContent
    ? `${rule.toolName}(${rule.ruleContent})`
    : rule.toolName;
}

/** « pnpm add » for `Bash(pnpm add:*)`: a command loses its wildcard. */
function ruleName(rule: PermissionRule): string {
  const content = rule.ruleContent?.trim();
  if (!content) return toolLabel(rule.toolName);
  if (rule.toolName === "Bash" || rule.toolName === "PowerShell") {
    return `« ${content.replace(/(:\*|\s\*)$/, "")} »`;
  }
  return `${toolLabel(rule.toolName)} « ${content.replace(/^domain:/, "")} »`;
}

/**
 * The button's words for a suggestion, or null for one it doesn't offer:
 * only what allows more (an allow rule, a mode, a folder) is worth a button.
 */
export function suggestionLabel(s: PermissionUpdate): string | null {
  const where = WHERE[s.destination] ?? WHERE.session;
  const always = lasting(s.destination) ? "Toujours autoriser" : "Autoriser";
  switch (s.type) {
    case "addRules":
      if (s.behavior !== "allow" || s.rules.length === 0) return null;
      return `${always} ${s.rules.map(ruleName).join(", ")} ${where}`;
    case "setMode":
      return s.mode === "acceptEdits"
        ? `Accepter les modifications ${where}`
        : `Passer en mode « ${modeLabel(s.mode)} » ${where}`;
    case "addDirectories":
      if (s.directories.length === 0) return null;
      return `${always} ${s.directories.length > 1 ? "les dossiers" : "le dossier"} ${s.directories
        .map((d) => `« ${folderOf(d) || d} »`)
        .join(", ")} ${where}`;
    default:
      return null;
  }
}

/** The tooltip: what exactly changes, and where it is kept. */
export function suggestionDetail(s: PermissionUpdate): string {
  const what =
    s.type === "setMode"
      ? `Mode ${s.mode}`
      : "rules" in s
        ? s.rules.map(ruleText).join(", ")
        : s.directories.join(", ");
  return `${what}, ${KEPT_IN[s.destination] ?? KEPT_IN.session}`;
}
