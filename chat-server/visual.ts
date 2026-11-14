// The chat's visuals: Claude's `show_visual` tool (an in-process MCP server
// of each chat) shows a finished HTML page inline in the column, above its
// reply. Local images go in as data URLs here, so the page survives its files
// moving; then the page renders it offscreen and reports what breaks, which
// becomes the tool's result (`visualResult`), before the user sees it.

import { mkdir, open, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  VISUAL_FIT_HEIGHT,
  VISUAL_HTML_MAX,
  VISUAL_SERVER,
  VISUAL_TITLE_MAX,
  VISUAL_TOOL,
  imageVerdict,
  localImageRefs,
  pageSizeError,
  staleVisualFiles,
  visualResult,
  withImages,
  type SkippedImage,
  type VisualReport,
} from "./visualHtml.ts";

/** A page ready for the column: its images in, and who asked for it. */
export interface PreparedVisual {
  /** The tool call's id (Claude Code's `_meta`): the column's card. */
  toolUseId: string | null;
  html: string;
  title: string;
  wide: boolean;
  /** Its copy with the images in was kept (`storedVisual`): a resumed chat asks for it. */
  stored: boolean;
}

/**
 * When a visual rather than an artifact (decided with Alexis on 31/10/2026).
 * In the tool's description as well as the chat's prompt: a recorded system
 * prompt (`snapshot`) keeps a resumed session on the prompt it began with,
 * while the tools' descriptions are read anew at each launch.
 */
const VISUAL_WHEN =
  "Use it for what helps now, in this conversation: explaining a mechanism, a plan or a diagnosis; comparing figures or 2 to 4 options; a quick choice (mockups or options the user picks, with a comment). Publish a claude.ai artifact instead only for a big page (a report, an audit, many mockup screens), something to share or reopen later (a link), something to fill over several days (a test checklist), or anything meant for outside Arkadia (the phone, someone else). Mermaid code fences keep rendering in the chat as before.";

/** What the tool's description tells Claude: when, how, and the theme. */
export const VISUAL_TOOL_DESCRIPTION = [
  "Show a finished, self-contained HTML page inline in this chat, above your final reply, where this call sits: a chart, a diagram or schema, a table, a comparison, steps, mockups, an image collage, or a choice with buttons. The user sees it in Arkadia's chat column; do not describe or restate it in your reply.",
  `When: ${VISUAL_WHEN}`,
  "html: a complete document (<!doctype html>…), inline <style> and <script>. Scripts may load only from https://cdn.jsdelivr.net, https://cdnjs.cloudflare.com or https://unpkg.com (Chart.js, d3, mermaid…). No fetch, XHR, WebSocket, iframe, worker or Trusted Types policy of its own (a library that makes one, like lit, fails): everything the page shows is in it. Remote images other than those CDNs are blocked; local images by absolute path (C:\\…\\shot.png in src, srcset or CSS url()) are inlined for you: name each once.",
  "Theme: use these CSS variables, never fixed colours: --bg (page background), --text, --muted, --faint, --card and --card-2 (a box), --border, --border-strong, --accent (#e2865f, the one accent) with --accent-text (text on it) and --accent-soft, --ok, --warn, --bad, --info, --chart-1 … --chart-6 (series, in order), --radius and --radius-sm, --font-sans, --font-serif, --font-mono. They are set on :root before your styles, with a base sheet (background, text colour, font, 16px gutter).",
  "Layout: leave html and body with no background, outer card, border, banner title or side padding: Arkadia frames the page in a card with your title. A box of its own gets var(--card), var(--radius) and 12-16px padding. Let the content set the height: no vh units, no height:100% on html or body. Give charts a fixed pixel height. Use fluid widths (the frame is about 740px wide, or the pane's full width with wide).",
  `Height: the whole visual should fit the chat pane without scrolling, about ${VISUAL_FIT_HEIGHT}px. Prefer compact layouts (side by side rather than stacked, short captions). Images and videos you leave unsized get max-height: var(--ark-fit-media) (the room left for one, a caption under it), except in a choice's options; one with a width, height or style attribute is left as you sized it, so size it to the space too. A taller page keeps its full size and width: the conversation scrolls past it.`,
  "wide: true when the content needs the pane's full width (mockups side by side, a table of many columns, a dense chart); otherwise leave it out.",
  'Choices: whenever the user picks among options (texts, subjects, plans, designs, settings), write this markup and Arkadia\'s kit draws it the house way (cards, the chosen one framed in orange, a « Conseillé » badge, tabs, keyboard, « Valider mes choix » at the bottom right), so every choice looks the same: add no CSS or script of your own for it. The kit sizes the choice to what it holds: set wide: true only when it needs the width (four short options or three long ones side by side), never for a few short ones. <div class="ark-choice" data-intro="Mes choix pour les mails"> holds questions, <div class="ark-question" data-title="Objet" data-sub="one short line"> (data-multi to allow several), each holding options: <div class="ark-option" data-reco>short label</div>, or a long one, <div class="ark-option" data-title="Name" data-sub="one line"><p>…</p></div> (any HTML but links and buttons). A picture in an option (a mockup) takes its card\'s width, up to its own size, never fitted to the pane\'s height: give it no size of your own, and crop a screenshot to what differs between the options rather than repeat what they share. Put data-reco on your recommended option in every question: it starts chosen. A group\'s first question is numbered 01, 02…, its second lettered A, B… (data-mark="num" or "letter" to force): keep one or two questions per group. Several sets (one per audience, list or step): wrap each in <section class="ark-group" data-title="Loueurs" data-sub="30 adresses" data-for="one line: who or what it is for">, shown as tabs; then every question sits in a group. Beside the questions, in a group or around the groups: <div class="ark-note" data-title="…" data-sub="…">a remark</div>, and <div class="ark-preview" data-title="Aperçu" data-sub="…">…</div> whose elements with data-from="<a question\'s data-title>" show that question\'s choice (its own group first; the option\'s data-preview, else its text); <div class="ark-mail"><b>Sender</b><span><b data-from="Objet"></b> · <span data-from="Texte"></span></span></div> draws an inbox row. Under each question the kit adds a field for the user\'s remark on it: never add one of your own. « Valider mes choix » puts one line per group (per question without groups) into the user\'s message box, each remark in its question\'s line. Write the markup in the page\'s HTML, never from a script.',
  "A single action that is not a choice among options: a button calling window.arkadia.choose(text) puts that text into the user's message box (not sent), so they can add a comment. Links open in the user's browser.",
  "Arkadia renders the page and checks it (script errors, console.error, blocked resources, empty or clipped page) before the user sees it. If the result lists problems, fix them and call show_visual again with the whole corrected page.",
].join("\n\n");

/** Every chat's rule of when to show a visual (`systemPrompt`). */
export const VISUAL_RULE = [
  "# Visuals in the chat",
  `This chat runs in Arkadia, which can show an HTML page right in the conversation: the show_visual tool. ${VISUAL_WHEN}`,
].join("\n");

/** Where a page's inlined copy is kept: a resumed chat shows it again. */
const STORE_DIR = join(process.env.LOCALAPPDATA ?? process.env.TEMP ?? ".", "Arkadia", "chat-visuals");

/** The tool call's id, as Claude Code passes it to an MCP server (`_meta`). */
export function toolUseIdOf(extra: unknown): string | null {
  const meta = (extra as { _meta?: Record<string, unknown> } | null)?._meta;
  const id = meta?.["claudecode/toolUseId"];
  return typeof id === "string" && /^[\w-]{1,128}$/.test(id) ? id : null;
}

const storePath = (toolUseId: string) => join(STORE_DIR, `${toolUseId}.html`);

/** Pruned once per server, at its first kept copy: never grows for good. */
let pruned = false;

async function pruneStore(): Promise<void> {
  if (pruned) return;
  pruned = true;
  const names = (await readdir(STORE_DIR)).filter((n) => n.endsWith(".html"));
  const files = await Promise.all(
    names.map(async (name) => {
      const info = await stat(join(STORE_DIR, name));
      return { name, mtimeMs: info.mtimeMs, size: info.size };
    }),
  );
  for (const name of staleVisualFiles(files, Date.now())) await unlink(join(STORE_DIR, name)).catch(() => {});
}

/** The inlined copy of a past visual, or null (none had local images). */
export async function storedVisual(toolUseId: string): Promise<string | null> {
  if (!/^[\w-]{1,128}$/.test(toolUseId)) return null;
  try {
    return await readFile(storePath(toolUseId), "utf8");
  } catch {
    return null;
  }
}

/** The first bytes of a file, enough to know an image by them. */
async function headOf(path: string): Promise<Uint8Array | null> {
  const file = await open(path, "r");
  try {
    const buf = new Uint8Array(4096);
    const { bytesRead } = await file.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

/** Each local image the page names, inlined when it really is one and fits. */
export async function inlineImages(
  html: string,
): Promise<{ html: string; inlined: number; skipped: SkippedImage[] }> {
  const urls = new Map<string, string>();
  const skipped: SkippedImage[] = [];
  let total = 0;
  for (const ref of localImageRefs(html)) {
    try {
      const info = await stat(ref.path);
      if (!info.isFile()) throw new Error("not a file");
      const verdict = imageVerdict(info.size, total, await headOf(ref.path), ref.mentions);
      if ("reason" in verdict) {
        skipped.push({ path: ref.path, reason: verdict.reason });
        continue;
      }
      const bytes = await readFile(ref.path);
      total += bytes.length * ref.mentions;
      urls.set(ref.raw, `data:${verdict.mime};base64,${bytes.toString("base64")}`);
    } catch {
      skipped.push({ path: ref.path, reason: "not found" });
    }
  }
  return { html: withImages(html, urls), inlined: urls.size, skipped };
}

/**
 * The chat's MCP server: `check` hands the page to Arkadia and resolves with
 * its report, or null when none came in time.
 */
export function visualServer(check: (visual: PreparedVisual) => Promise<VisualReport | null>) {
  return createSdkMcpServer({
    name: VISUAL_SERVER,
    version: "1.0.0",
    // Always in the prompt: a deferred tool would never be thought of.
    alwaysLoad: true,
    tools: [
      tool(
        VISUAL_TOOL,
        VISUAL_TOOL_DESCRIPTION,
        {
          html: z.string().min(1).max(VISUAL_HTML_MAX).describe("A complete, self-contained HTML document."),
          title: z.string().min(1).max(VISUAL_TITLE_MAX).describe("A short title, shown in the card's band."),
          wide: z.boolean().optional().describe("The pane's full width instead of the messages column."),
        },
        async ({ html, title, wide }, extra) => {
          const toolUseId = toolUseIdOf(extra);
          const prepared = await inlineImages(html);
          // Too heavy to travel to the page: refused before anything is sent.
          const tooLarge = pageSizeError(prepared.html);
          if (tooLarge) return { content: [{ type: "text" as const, text: tooLarge }], isError: true };
          // Kept for a resumed chat: the call's input has the paths, not the images.
          let stored = false;
          if (toolUseId && prepared.inlined > 0) {
            stored = await mkdir(STORE_DIR, { recursive: true })
              .then(() => writeFile(storePath(toolUseId), prepared.html, "utf8"))
              .then(
                () => true,
                () => false,
              );
            void pruneStore().catch(() => {});
          }
          const report = await check({
            toolUseId,
            html: prepared.html,
            title: title.trim(),
            wide: wide === true,
            stored,
          });
          const { text, isError } = visualResult(report, prepared.skipped);
          return { content: [{ type: "text" as const, text }], isError };
        },
        // Shows a page in the chat, touches nothing: never a permission prompt.
        { annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
      ),
    ],
  });
}
