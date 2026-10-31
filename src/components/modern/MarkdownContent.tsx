import {
  createContext,
  isValidElement,
  memo,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { backendInvoke, openUrl } from "@/lib/bridge";
import { Check, Copy, SquareArrowOutUpRight } from "lucide-react";
import Markdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { MermaidBlock } from "@/components/modern/MermaidBlock";
import {
  InlineImage,
  type LightboxContent,
} from "@/components/modern/ImageThumb";
import {
  IMAGE_LABEL_PROP,
  IMAGE_PATH_PROP,
  rehypeInlineImages,
  type HastNode,
} from "@/lib/rehypeInlineImages";
import { imageCaptions } from "@/lib/imageCaption";
import { InlineVideo } from "@/components/modern/VideoThumb";
import { imagePathKey, isVideoPath, splitImagePaths } from "@/lib/imagePaths";
import { fetchImageUrl } from "@/lib/imageUrlCache";
import { LinkCardsContext } from "@/lib/linkCards";

export type ToastFn = (level: "info" | "error", message: string) => void;

const REMARK_PLUGINS = [remarkGfm];

/** The captions of the message being rendered, keyed by `imagePathKey`. */
const CaptionsContext = createContext<Map<string, string>>(new Map());

/** An image or video path mention, carrying its caption to the lightbox. */
function MentionImage(
  props: Omit<React.ComponentProps<typeof InlineImage>, "caption">,
) {
  const captions = useContext(CaptionsContext);
  const caption = captions.get(imagePathKey(props.path));
  return isVideoPath(props.path) ? (
    <InlineVideo {...props} caption={caption} />
  ) : (
    <InlineImage {...props} caption={caption} />
  );
}

/**
 * An image or video path left as written (`inlineImages` off: the chat shows
 * it in the message's strip): a click opens it in the lightbox, or with the
 * PC's own app when it doesn't load. Inline-level, inside a `<p>`/`<li>`.
 */
function ImagePathLink({
  path,
  label,
  code,
  onOpen,
  onToast,
}: {
  path: string;
  label: string;
  code: boolean;
  onOpen: (content: LightboxContent) => void;
  onToast?: ToastFn;
}) {
  const Tag = code ? "code" : "span";
  return (
    <Tag
      className="modern-imgpath"
      title={`Voir ${path}`}
      onClick={(e) => {
        e.stopPropagation();
        if (isVideoPath(path)) {
          onOpen({ kind: "video", path });
          return;
        }
        void fetchImageUrl(path).then((url) => {
          if (url) onOpen({ kind: "image", url, path });
          else openPath(path, onToast);
        });
      }}
    >
      {label}
    </Tag>
  );
}

/** Told what a code block's button copied, or why it couldn't. */
export interface CodeCopyListener {
  copied: (code: string) => void;
  failed: (error: unknown) => void;
}

/**
 * Where a code block reports its copies: the chat provides it and toasts,
 * the reading view leaves it out and stays silent.
 */
export const CodeCopyContext = createContext<CodeCopyListener | null>(null);

/**
 * A fenced code block with a hover-revealed "copy" button in its bottom-right
 * corner. The text is read back from the rendered `<pre>` so whatever the
 * highlighter put in there is what lands on the clipboard.
 */
function CodeBlock({ children, ...rest }: React.ComponentProps<"pre">) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const listener = useContext(CodeCopyContext);

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
              listener?.copied(text);
            })
            .catch((err: unknown) => listener?.failed(err));
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

/** The plain text of a link's children: its label. */
function textOf(children: React.ReactNode): string {
  if (typeof children === "string" || typeof children === "number")
    return String(children);
  if (Array.isArray(children)) return children.map(textOf).join("");
  return "";
}

/**
 * A link: opened in the browser (an artifact in its panel, `openLink`), or
 * drawn by the view when it asks for it (`LinkCardsContext`, the chat's
 * artifact cards).
 */
function MarkdownLink({
  href,
  children,
}: {
  href?: string;
  children?: React.ReactNode;
}) {
  const cards = useContext(LinkCardsContext);
  if (href && cards?.match(href)) {
    return <cards.Card href={href} label={textOf(children)} />;
  }
  return (
    <a
      onClick={(e) => {
        e.preventDefault();
        if (href) void openUrl(href).catch(() => {});
      }}
      title={href}
    >
      {children}
    </a>
  );
}

/** Opens a file with the OS default app; failures surface as a toast. */
export function openPath(path: string, onToast?: ToastFn) {
  backendInvoke("open_path", { path }).catch((e) => {
    onToast?.("error", `Ouverture impossible : ${String(e)}`);
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
  inlineImages = true,
): Components {
  return {
    // The marker the plugin above leaves behind. Every other span — the
    // highlighter's code tokens — passes straight through.
    span: ({ node, children, ...rest }) => {
      const props = (node as HastNode | undefined)?.properties;
      const path = props?.[IMAGE_PATH_PROP];
      if (typeof path === "string") {
        const label = props?.[IMAGE_LABEL_PROP];
        const text = typeof label === "string" ? label : path;
        return inlineImages ? (
          <MentionImage path={path} label={text} onOpen={onOpen} />
        ) : (
          <ImagePathLink
            path={path}
            label={text}
            code={false}
            onOpen={onOpen}
            onToast={onToast}
          />
        );
      }
      return <span {...rest}>{children}</span>;
    },
    a: ({ href, children }) => (
      <MarkdownLink href={href}>{children}</MarkdownLink>
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
          return inlineImages ? (
            <MentionImage
              path={segments[0].path}
              label={children}
              onOpen={onOpen}
            />
          ) : (
            <ImagePathLink
              path={segments[0].path}
              label={children}
              code
              onOpen={onOpen}
              onToast={onToast}
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
  /** Off: an image path stays text that opens it on click, the image itself
   *  shown elsewhere (the chat's strip under the message). On by default. */
  inlineImages?: boolean;
}

/** The shared markdown body of the modern view (bubbles, plan cards). */
export const MarkdownContent = memo(function MarkdownContent({
  text,
  baseDir,
  onOpen,
  onToast,
  inlineImages = true,
}: MarkdownContentProps) {
  const components = useMemo(
    () => buildComponents(onOpen, onToast, baseDir, inlineImages),
    [onOpen, onToast, baseDir, inlineImages],
  );
  // Through context, not `components`: rebuilding those on every streamed
  // chunk would remount every image and diagram of the message.
  const captions = useMemo(() => imageCaptions(text, baseDir), [text, baseDir]);
  // Only explicitly-tagged fences highlight; auto-detection would run on every
  // untagged block for little value.
  const rehypePlugins = useMemo(
    () =>
      [
        [rehypeHighlight, { detect: false }],
        [rehypeInlineImages, { source: text, baseDir, group: inlineImages }],
      ] as never[],
    [text, baseDir, inlineImages],
  );
  return (
    <CaptionsContext.Provider value={captions}>
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {text}
      </Markdown>
    </CaptionsContext.Provider>
  );
});
