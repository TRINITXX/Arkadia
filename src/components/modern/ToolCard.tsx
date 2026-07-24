import { Fragment, memo, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  MarkdownContent,
  clickablePath,
  openPath,
  type ToastFn,
} from "@/components/modern/MarkdownContent";
import {
  ThumbStrip,
  type LightboxContent,
} from "@/components/modern/ImageThumb";
import { highlightHtml, langForPath } from "@/components/modern/highlight";
import { toolIcon } from "@/components/modern/toolIcons";
import { findImagePaths } from "@/lib/imagePaths";
import type { ConvBlock } from "@/components/ModernConversationView";
import type { ToolDensity } from "@/types";

/** Best-effort one-line summary of a tool call for the card header. */
function toolSummary(input: Record<string, unknown>): string {
  const pick =
    input.command ??
    input.file_path ??
    input.path ??
    input.pattern ??
    input.url ??
    input.query ??
    input.description;
  const s = typeof pick === "string" ? pick.split("\n")[0] : "";
  return s.length > 90 ? `${s.slice(0, 90)}…` : s;
}

/** Parses the tool input JSON; `{}` on failure or non-object. */
function parseInput(json?: string): Record<string, unknown> {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function str(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * Trims the common leading/trailing lines between `oldText` and `newText` so a
 * diff shows only what actually changed (+ 2 lines of context), like a terminal
 * unified diff — not the whole block dumped twice.
 */
function trimmedDiff(oldText: string, newText: string) {
  const o = oldText.length ? oldText.split("\n") : [];
  const n = newText.length ? newText.split("\n") : [];
  let start = 0;
  while (start < o.length && start < n.length && o[start] === n[start]) start++;
  let endO = o.length;
  let endN = n.length;
  while (endO > start && endN > start && o[endO - 1] === n[endN - 1]) {
    endO--;
    endN--;
  }
  return {
    before: o.slice(Math.max(0, start - 2), start),
    removed: o.slice(start, endO),
    added: n.slice(start, endN),
    after: o.slice(endO, endO + 2),
  };
}

/** "+5 −1" style change counter for a tool card header. */
function statStr(removed: number, added: number): string {
  const parts: string[] = [];
  if (added) parts.push(`+${added}`);
  if (removed) parts.push(`−${removed}`);
  return parts.join(" ");
}

function toolStat(name: string, input: Record<string, unknown>): string {
  if (name === "Edit") {
    const d = trimmedDiff(
      str(input, "old_string") ?? "",
      str(input, "new_string") ?? "",
    );
    return statStr(d.removed.length, d.added.length);
  }
  if (name === "MultiEdit") {
    const edits = Array.isArray(input.edits) ? input.edits : [];
    let rem = 0;
    let add = 0;
    for (const e of edits) {
      const eo = (e ?? {}) as Record<string, unknown>;
      const d = trimmedDiff(
        typeof eo.old_string === "string" ? eo.old_string : "",
        typeof eo.new_string === "string" ? eo.new_string : "",
      );
      rem += d.removed.length;
      add += d.added.length;
    }
    return statStr(rem, add);
  }
  if (name === "Write") {
    const c = str(input, "content") ?? "";
    return c ? `+${c.split("\n").length}` : "";
  }
  return "";
}

/** A tight unified diff: a little context (dim) + removed (red) + added (green). */
function DiffLines({
  oldText,
  newText,
}: {
  oldText?: string;
  newText?: string;
}) {
  const d = trimmedDiff(oldText ?? "", newText ?? "");
  return (
    <div className="modern-diff">
      {d.before.map((l, i) => (
        <div key={`b${i}`} className="cl">{`  ${l}`}</div>
      ))}
      {d.removed.map((l, i) => (
        <div key={`r${i}`} className="dl">{`- ${l}`}</div>
      ))}
      {d.added.map((l, i) => (
        <div key={`a${i}`} className="al">{`+ ${l}`}</div>
      ))}
      {d.after.map((l, i) => (
        <div key={`f${i}`} className="cl">{`  ${l}`}</div>
      ))}
    </div>
  );
}

function GenericParams({ input }: { input: Record<string, unknown> }) {
  const entries = Object.entries(input);
  if (entries.length === 0) return null;
  return (
    <div className="modern-params">
      {entries.map(([k, v]) => (
        <Fragment key={k}>
          <span className="k">{k}</span>
          <span className="v">
            {typeof v === "string" ? v : JSON.stringify(v)}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

/** Syntax-highlighted code, falling back to plain text for unknown languages. */
function HighlightedCode({
  code,
  lang,
  prefix,
}: {
  code: string;
  lang: string | null;
  prefix?: React.ReactNode;
}) {
  const html = useMemo(() => highlightHtml(code, lang), [code, lang]);
  if (html === null) {
    return (
      <pre className="modern-code">
        {prefix}
        {code}
      </pre>
    );
  }
  return (
    <pre className="modern-code hljs">
      {prefix}
      <span dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}

/** Renders a tool's input the way the terminal would — diff, code, or params. */
function ToolInputView({
  name,
  input,
  onOpen,
  onToast,
}: {
  name: string;
  input: Record<string, unknown>;
  onOpen: (content: LightboxContent) => void;
  onToast?: ToastFn;
}) {
  switch (name) {
    case "Edit":
      return (
        <DiffLines
          oldText={str(input, "old_string")}
          newText={str(input, "new_string")}
        />
      );
    case "MultiEdit": {
      const edits = Array.isArray(input.edits) ? input.edits : [];
      return (
        <>
          {edits.map((e, i) => {
            const eo = (e ?? {}) as Record<string, unknown>;
            return (
              <DiffLines
                key={i}
                oldText={typeof eo.old_string === "string" ? eo.old_string : ""}
                newText={typeof eo.new_string === "string" ? eo.new_string : ""}
              />
            );
          })}
        </>
      );
    }
    case "Write":
      return (
        <HighlightedCode
          code={str(input, "content") ?? ""}
          lang={langForPath(str(input, "file_path") ?? "")}
        />
      );
    case "Bash":
      return (
        <HighlightedCode
          code={str(input, "command") ?? ""}
          lang="bash"
          prefix={<span className="p">$ </span>}
        />
      );
    case "ExitPlanMode":
      return (
        <div className="reading-md">
          <MarkdownContent
            text={str(input, "plan") ?? ""}
            onOpen={onOpen}
            onToast={onToast}
          />
        </div>
      );
    case "Read":
    case "Grep":
    case "Glob":
    case "LS":
      // The header summary (path/pattern) + the output below already say it all.
      return null;
    default:
      return <GenericParams input={input} />;
  }
}

interface ToolCardProps {
  block: ConvBlock;
  density: ToolDensity;
  showResults: boolean;
  onOpen: (content: LightboxContent) => void;
  onToast?: ToastFn;
}

export const ToolCard = memo(function ToolCard({
  block,
  density,
  showResults,
  onOpen,
  onToast,
}: ToolCardProps) {
  const [open, setOpen] = useState(density === "full");
  const input = useMemo(() => parseInput(block.tool_input), [block.tool_input]);
  const summary = toolSummary(input);
  const output = showResults ? (block.tool_output ?? "") : "";
  const outputImages = showResults ? (block.tool_output_images ?? []) : [];
  const name = block.tool_name ?? "tool";
  const stat = toolStat(name, input);
  const Icon = toolIcon(name);
  // Collapsed by default = a single short header line; click (or density "full")
  // expands to the diff / code / output.
  const expanded = density === "full" || open;

  // The header path (Read/Grep on a file…) opens with the OS default app.
  const headerPath = clickablePath(summary);

  // On-disk image paths mentioned in the input/output (source c): only when
  // the transcript itself carried no images for this call.
  const pathThumbs = useMemo(() => {
    if (outputImages.length > 0) return [];
    const candidates = new Set<string>();
    for (const key of ["file_path", "path"]) {
      const v = str(input, key);
      if (v) for (const p of findImagePaths(v, 1)) candidates.add(p);
    }
    if (output) for (const p of findImagePaths(output)) candidates.add(p);
    return [...candidates].slice(0, 4).map((path) => ({ path }));
  }, [input, output, outputImages.length]);

  return (
    <div className="modern-tool">
      <div
        className="modern-tool-head"
        onClick={() => setOpen((v) => !v)}
        title="Déplier / replier"
      >
        <span className="ico">
          <Icon size={13} />
        </span>
        <span className="name">{name}</span>
        {headerPath ? (
          <span
            className="arg modern-path"
            title={`Ouvrir ${headerPath}`}
            onClick={(e) => {
              e.stopPropagation();
              openPath(headerPath, onToast);
            }}
          >
            {summary}
          </span>
        ) : (
          <span className="arg">{summary}</span>
        )}
        {stat && <span className="stat">{stat}</span>}
        <span className={`chev${expanded ? " open" : ""}`}>
          <ChevronRight size={12} />
        </span>
      </div>
      {/* The wrapper stays mounted (grid 0fr→1fr animates the open); the body
          itself mounts on expand only, so collapsed cards stay cheap. */}
      <div className={`modern-tool-bodywrap${expanded ? " open" : ""}`}>
        {expanded && (
          <div className="modern-tool-body">
            <ToolInputView
              name={name}
              input={input}
              onOpen={onOpen}
              onToast={onToast}
            />
            {(output.length > 0 ||
              outputImages.length > 0 ||
              pathThumbs.length > 0) && (
              <div
                className="modern-tool-out"
                style={{ marginTop: 8, paddingTop: 6 }}
              >
                <span className="lbl">résultat</span>
                {output.length > 0 && <pre>{output}</pre>}
                <ThumbStrip
                  paths={[
                    ...outputImages.map((img) => ({
                      path: img.path,
                      mediaType: img.media_type,
                    })),
                    ...pathThumbs,
                  ]}
                  onOpen={onOpen}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
