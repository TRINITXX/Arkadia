import {
  Children,
  Fragment,
  isValidElement,
  memo,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { Check, Copy, SquareArrowOutUpRight } from "lucide-react";
import Markdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { MermaidBlock } from "@/components/modern/MermaidBlock";
import {
  InlineImage,
  type LightboxContent,
} from "@/components/modern/ImageThumb";
import { splitImagePaths } from "@/lib/imagePaths";

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
 * Text children with every image path mention swapped for the image itself,
 * rendered where it was written. Other children (bold, links…) pass through.
 */
function inlineImages(
  children: React.ReactNode,
  onOpen: (content: LightboxContent) => void,
  baseDir?: string | null,
): React.ReactNode {
  return Children.map(children, (child) => {
    if (typeof child !== "string") return child;
    const segments = splitImagePaths(child, baseDir);
    if (segments.length === 1 && !segments[0].path) return child;
    return segments.map((seg, i) =>
      seg.path ? (
        <InlineImage key={i} path={seg.path} label={seg.text} onOpen={onOpen} />
      ) : (
        <Fragment key={i}>{seg.text}</Fragment>
      ),
    );
  });
}

/**
 * The markdown component overrides, bound to the lightbox/toast callbacks:
 * external links open in the browser, fences get a copy button, ```mermaid
 * renders as a diagram, image paths render as images, and inline code that is
 * some other file path opens on click.
 */
function buildComponents(
  onOpen: (content: LightboxContent) => void,
  onToast?: ToastFn,
  baseDir?: string | null,
): Components {
  return {
    p: ({ node: _node, children, ...rest }) => (
      <p {...rest}>{inlineImages(children, onOpen, baseDir)}</p>
    ),
    li: ({ node: _node, children, ...rest }) => (
      <li {...rest}>{inlineImages(children, onOpen, baseDir)}</li>
    ),
    td: ({ node: _node, children, ...rest }) => (
      <td {...rest}>{inlineImages(children, onOpen, baseDir)}</td>
    ),
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
      // Inline code (no language class) that is exactly a file path → the
      // image itself, or a click that opens it with the OS default app. Block
      // code is left to `pre` above.
      if (!className && typeof children === "string") {
        const segments = splitImagePaths(children, baseDir);
        if (segments.length === 1 && segments[0].path) {
          return (
            <InlineImage
              path={segments[0].path}
              label={children}
              onOpen={onOpen}
            />
          );
        }
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
  /** The session's working directory, for relative image paths. */
  baseDir?: string | null;
  onOpen: (content: LightboxContent) => void;
  onToast?: ToastFn;
}

/** The shared markdown body of the modern view (bubbles, plan cards). */
export const MarkdownContent = memo(function MarkdownContent({
  text,
  baseDir,
  onOpen,
  onToast,
}: MarkdownContentProps) {
  const components = useMemo(
    () => buildComponents(onOpen, onToast, baseDir),
    [onOpen, onToast, baseDir],
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
