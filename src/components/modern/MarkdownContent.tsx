import { isValidElement, memo, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { Check, Copy, SquareArrowOutUpRight } from "lucide-react";
import Markdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { MermaidBlock } from "@/components/modern/MermaidBlock";
import type { LightboxContent } from "@/components/modern/ImageThumb";

export type ToastFn = (level: "info" | "error", message: string) => void;

// Only explicitly-tagged fences highlight; auto-detection would run on every
// untagged block for little value.
const REHYPE_PLUGINS = [[rehypeHighlight, { detect: false }]] as never[];
const REMARK_PLUGINS = [remarkGfm];

/**
 * A fenced code block with a hover-revealed "copy" button in its bottom-right
 * corner. The text is read back from the rendered `<pre>` so whatever the
 * highlighter put in there is what lands on the clipboard.
 */
function CodeBlock({ children, ...rest }: React.ComponentProps<"pre">) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  return (
    <div className="modern-codeblock">
      <pre ref={preRef} {...rest}>
        {children}
      </pre>
      <button
        type="button"
        className={`modern-code-copy${copied ? " copied" : ""}`}
        title="Copier le bloc de code"
        aria-label="Copier le bloc de code"
        onClick={(e) => {
          e.stopPropagation();
          const text = preRef.current?.textContent ?? "";
          if (!text) return;
          void navigator.clipboard
            .writeText(text)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            })
            .catch(() => {});
        }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  );
}

/**
 * `text` when it is an absolute Windows file path (optionally `:line:col`
 * suffixed, which is stripped), else `null`. Colons are only legal after the
 * drive letter, so `https://…` and prose never match.
 */
export function clickablePath(text: string): string | null {
  const m = /^([A-Za-z]:[\\/][^"'<>|?*:\n]+?)(?::\d+(?::\d+)?)?$/.exec(
    text.trim(),
  );
  return m ? m[1] : null;
}

/** Opens a file with the OS default app; failures surface as a toast. */
export function openPath(path: string, onToast?: ToastFn) {
  invoke("open_path", { path }).catch((e) => {
    onToast?.("error", `Ouverture impossible : ${String(e)}`);
  });
}

/**
 * The markdown component overrides, bound to the lightbox/toast callbacks:
 * external links open in the browser, fences get a copy button, ```mermaid
 * renders as a diagram, inline code that is a file path opens on click.
 */
function buildComponents(
  onOpen: (content: LightboxContent) => void,
  onToast?: ToastFn,
): Components {
  return {
    a: ({ href, children }) => (
      <a
        onClick={(e) => {
          e.preventDefault();
          if (href) void openExternal(href).catch(() => {});
        }}
        title={href}
      >
        {children}
      </a>
    ),
    pre: (props) => {
      // A ```mermaid fence arrives as <pre><code class="language-mermaid">.
      const child = props.children;
      if (
        isValidElement<{ className?: string; children?: unknown }>(child) &&
        typeof child.props.className === "string" &&
        child.props.className.includes("language-mermaid") &&
        typeof child.props.children === "string"
      ) {
        return <MermaidBlock code={child.props.children} onOpen={onOpen} />;
      }
      return <CodeBlock {...props} />;
    },
    code: (props) => {
      const { className, children } = props;
      // Inline code (no language class) that is exactly a file path → opens
      // with the OS default app. Block code is left to `pre` above.
      if (!className && typeof children === "string") {
        const path = clickablePath(children);
        if (path) {
          return (
            <code
              className="modern-path"
              title={`Ouvrir ${path}`}
              onClick={(e) => {
                e.stopPropagation();
                openPath(path, onToast);
              }}
            >
              {children}
              <span className="ext-ico">
                <SquareArrowOutUpRight size={10} />
              </span>
            </code>
          );
        }
      }
      return <code {...props} />;
    },
  };
}

interface MarkdownContentProps {
  text: string;
  onOpen: (content: LightboxContent) => void;
  onToast?: ToastFn;
}

/** The shared markdown body of the modern view (bubbles, plan cards). */
export const MarkdownContent = memo(function MarkdownContent({
  text,
  onOpen,
  onToast,
}: MarkdownContentProps) {
  const components = useMemo(
    () => buildComponents(onOpen, onToast),
    [onOpen, onToast],
  );
  return (
    <Markdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      components={components}
    >
      {text}
    </Markdown>
  );
});
