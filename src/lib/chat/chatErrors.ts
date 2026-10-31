import type { JsonObject } from "@/lib/chat/chatProtocol";
import { resetClock } from "@/lib/chat/chatQuota";

/**
 * Why a turn stopped, in words with the next step: the result's
 * `terminal_reason`, its `errors`, a refused start (`startup_failure_reason`)
 * and the API error Claude Code wrote as Claude's reply (`assistant.error`).
 * And Claude Code's retries of a failed request, for the live line.
 */

export interface ErrorNotice {
  text: string;
  tone: "info" | "warning" | "error";
  /** Claude Code's own words, under the notice. */
  detail?: string;
}

/** What the turn's notice needs of the chat besides the result. */
export interface ResultContext {
  /** The `error` code of the turn's API error reply, if any. */
  apiError: string | null;
  /** The reset of the window that blocks (epoch seconds), if known. */
  resetsAt?: number;
  now: number;
  /** The turn carries Claude Code's « [Request interrupted by user] ». */
  interrupted?: boolean;
}

/** Ends a hook can give a turn, but also the user's Esc while it runs. */
const HOOK_ENDS = new Set(["stop_hook_prevented", "hook_stopped"]);

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

const CONTEXT_FULL =
  "Contexte plein : lance /compact pour résumer la conversation, ou /clear pour repartir de zéro";

/** Turn ends that are no API error, by `terminal_reason`. */
const REASONS: Record<string, ErrorNotice> = {
  prompt_too_long: { text: CONTEXT_FULL, tone: "error" },
  blocking_limit: { text: CONTEXT_FULL, tone: "error" },
  rapid_refill_breaker: {
    text: "Le contexte se remplit aussitôt compacté : lance /clear, ou /compact avec une consigne plus courte",
    tone: "error",
  },
  max_turns: {
    text: "Nombre maximal d'étapes atteint : envoie un message pour continuer",
    tone: "warning",
  },
  budget_exhausted: {
    text: "Budget de la session atteint : Claude s'arrête là",
    tone: "warning",
  },
  image_error: {
    text: "Image refusée par l'API : retire-la, ou colle-la plus petite",
    tone: "error",
  },
  model_error: {
    text: "Modèle indisponible : choisis-en un autre dans la saisie",
    tone: "error",
  },
  malformed_tool_use_exhausted: {
    text: "Claude a raté ses appels d'outil plusieurs fois de suite : renvoie ta demande, ou change de modèle",
    tone: "error",
  },
  structured_output_retry_exhausted: {
    text: "Réponse structurée impossible après plusieurs essais",
    tone: "error",
  },
  stop_hook_prevented: {
    text: "Claude arrêté par un hook Stop",
    tone: "info",
  },
  hook_stopped: { text: "Tour arrêté par un hook", tone: "info" },
};

/** Error result subtypes that say it alone (older CLIs set no reason). */
const SUBTYPES: Record<string, string> = {
  error_max_turns: "max_turns",
  error_max_budget_usd: "budget_exhausted",
  error_max_structured_output_retries: "structured_output_retry_exhausted",
};

const RECONNECT =
  "Connexion au compte refusée : reconnecte-toi dans un terminal (claude puis /login)";

/** API errors (`assistant.error`, the result's `api_error`), with what to do. */
const API_ERRORS: Record<string, string> = {
  authentication_failed: RECONNECT,
  oauth_org_not_allowed:
    "Ce compte n'a pas accès à Claude Code pour son organisation : change de compte",
  account_on_hold: "Compte suspendu : voir claude.ai",
  verification_required:
    "Vérification du compte demandée : ouvre claude.ai pour la faire",
  billing_error:
    "Problème de facturation du compte : vérifie l'abonnement sur claude.ai",
  overloaded: "API surchargée : renvoie ton message dans un moment",
  model_not_found: "Modèle introuvable : choisis-en un autre dans la saisie",
  invalid_request: "Requête refusée par l'API",
  max_output_tokens: "Réponse coupée à la longueur maximale : demande la suite",
  server_error:
    "Erreur du serveur d'Anthropic : renvoie ton message dans un moment",
  connection_failed:
    "Connexion à l'API impossible : vérifie le réseau, puis renvoie ton message",
  cloud_credential_error: "Identifiants du fournisseur cloud refusés",
};

/** Why Claude Code refused to start, with the fix. */
const STARTUP: Record<string, string> = {
  cwd_unavailable: "Dossier du projet introuvable ou illisible",
  shell_tool_missing: "Ni Git Bash ni PowerShell : installe Git pour Windows",
  cli_version_too_old:
    "Claude Code trop ancien : mets-le à jour (claude update)",
  session_held_by_background: "Cette conversation tourne déjà en tâche de fond",
  gateway_signin_required: RECONNECT,
  org_config_refused: RECONNECT,
  org_verify_failed:
    "Organisation du compte non vérifiée : vérifie le réseau, puis relance",
  org_config_required_unavailable:
    "Réglages de l'organisation injoignables : vérifie le réseau, puis relance",
  remote_settings_required_unavailable:
    "Réglages de l'organisation injoignables : vérifie le réseau, puis relance",
  proxy_invalid: "Réglage de proxy invalide",
  temp_dir_unusable: "Dossier temporaire inutilisable",
  worktree_unverified: "Worktree de la session non vérifié : relance",
  worktree_resume_refused: "Reprise refusée dans ce worktree",
};

/** An API error by its code, else its HTTP status. */
function apiErrorText(
  code: string | undefined,
  status: number | undefined,
  ctx: ResultContext,
): string {
  if (code === "rate_limit" || status === 429) {
    // The quota alert said which window: here, the turn and what to do.
    const when =
      ctx.resetsAt === undefined ? "" : ` ${resetClock(ctx.resetsAt, ctx.now)}`;
    return `Tour arrêté par la limite d'usage : attends le reset${when}, ou passe sur un autre compte`;
  }
  if (code && API_ERRORS[code]) return API_ERRORS[code];
  if (status === 401 || status === 403) return RECONNECT;
  if (status === 529) return API_ERRORS.overloaded;
  if (status !== undefined && status >= 500) return API_ERRORS.server_error;
  return "Erreur de l'API";
}

/** Claude Code's own diagnostics, not meant for a reader. */
const isDiagnostic = (e: string) => e.startsWith("[ede_diagnostic]");

const reasonOf = (m: JsonObject): string | undefined =>
  str(m.terminal_reason) ?? SUBTYPES[str(m.subtype) ?? ""];

/**
 * The user ended the turn (Esc, « Envoyer maintenant »). An Esc during a
 * Stop hook ends it as the hook would: the user's note (`interrupted`) says
 * who stopped it (verified live 31/10/2026).
 */
export function stoppedByUser(m: JsonObject, interrupted: boolean): boolean {
  const reason = reasonOf(m);
  return (
    reason === "aborted_streaming" ||
    reason === "aborted_tools" ||
    (interrupted && reason !== undefined && HOOK_ENDS.has(reason))
  );
}

/**
 * The notice a finished turn adds, or null: a turn that went well, or one
 * whose end needs no word. Only a user's interrupt says « Tour interrompu ».
 */
export function resultNotice(
  m: JsonObject,
  ctx: ResultContext,
): ErrorNotice | null {
  const reason = reasonOf(m);
  const errors = (Array.isArray(m.errors) ? m.errors : []).filter(
    (e): e is string => typeof e === "string" && !isDiagnostic(e),
  );
  const ok = m.subtype === "success" && m.is_error !== true;
  if (stoppedByUser(m, ctx.interrupted ?? false))
    return { text: "Tour interrompu", tone: "info" };
  const startup = str(m.startup_failure_reason);
  if (startup) {
    return {
      text: STARTUP[startup] ?? "Claude Code a refusé de démarrer",
      tone: "error",
      detail: errors[0],
    };
  }
  if (reason && REASONS[reason]) {
    const notice = REASONS[reason];
    // A hook's stop on a turn that went well: said quietly.
    return ok || notice.tone !== "info"
      ? notice
      : { ...notice, tone: "warning" };
  }
  if (ok) return null;
  const apiCode = str(m.api_error) ?? ctx.apiError ?? undefined;
  const status = num(m.api_error_status);
  if (reason === "api_error" || ctx.apiError || apiCode || status) {
    // The reply already shows Claude Code's words: only the cause and the
    // next step here.
    return {
      text: apiErrorText(apiCode, status, ctx),
      tone: "error",
      detail: ctx.apiError ? undefined : str(m.result),
    };
  }
  return {
    text: "Le tour s'est arrêté sur une erreur",
    tone: "error",
    detail: errors[0] ?? str(m.result) ?? str(m.subtype),
  };
}

/** A request Claude Code will send again (`api_retry`). */
export interface RetryInfo {
  attempt: number;
  max: number;
  /** When it was said, and the wait before the next try. */
  at: number;
  delayMs: number;
  cause: string;
}

/** A failed request's cause, in a word or two. */
function retryCause(m: JsonObject): string {
  const code = str(m.error);
  const status = num(m.error_status);
  if (code === "overloaded" || status === 529) return "surcharge";
  if (code === "rate_limit" || status === 429) return "limite d'usage";
  if (code === "authentication_failed" || status === 401)
    return "connexion au compte";
  if (m.no_response) return "pas de réponse";
  if (status === undefined) return "connexion";
  if (status >= 500 || code === "server_error") return "erreur du serveur";
  return `erreur ${status}`;
}

export function retryOf(m: JsonObject, now: number): RetryInfo {
  return {
    attempt: num(m.attempt) ?? 1,
    max: num(m.max_retries) ?? 0,
    at: now,
    delayMs: num(m.retry_delay_ms) ?? 0,
    cause: retryCause(m),
  };
}

/** « Claude réessaie (2/10) dans 5 s · surcharge », the wait counted down. */
export function retryLabel(retry: RetryInfo, now: number): string {
  const count = retry.max > 0 ? ` (${retry.attempt}/${retry.max})` : "";
  const left = Math.ceil((retry.at + retry.delayMs - now) / 1000);
  const wait = left > 0 ? ` dans ${left} s` : "…";
  return `Claude réessaie${count}${wait} · ${retry.cause}`;
}
