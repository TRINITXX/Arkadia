import { memo, useEffect, useState } from "react";
import type { LightboxContent } from "@/components/modern/ImageThumb";

// The mermaid engine is ~1.5 MB: dynamically imported on the first diagram
// only (Vite code-splits it out of the initial bundle), initialized once.
let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
function getMermaid() {
  mermaidPromise ??= import("mermaid").then((m) => {
    m.default.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "dark",
      themeVariables: {
        primaryColor: "#a855f7",
        background: "#111114",
        fontFamily: 'ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif',
      },
    });
    return m.default;
  });
  return mermaidPromise;
}

// source → rendered SVG, so re-mounts (filter toggles, generation resets)
// are instant. Bounded: oldest entries dropped.
const svgCache = new Map<string, string>();
const SVG_CACHE_MAX = 50;
let renderSeq = 0;

interface MermaidBlockProps {
  code: string;
  onOpen: (content: LightboxContent) => void;
}

/**
 * Renders a ```mermaid fence as an SVG diagram. The render is debounced
 * (streaming yields partial sources); a parse failure keeps the last good
 * SVG when there is one, else shows the source with an "invalid" caption.
 */
export const MermaidBlock = memo(function MermaidBlock({
  code,
  onOpen,
}: MermaidBlockProps) {
  const [svg, setSvg] = useState<string | null>(
    () => svgCache.get(code) ?? null,
  );
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    const cached = svgCache.get(code);
    if (cached) {
      setSvg(cached);
      setInvalid(false);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      void getMermaid()
        .then(async (mermaid) => {
          // parse() first: render() can leave orphan error nodes in the DOM.
          await mermaid.parse(code);
          return mermaid.render(`modern-mermaid-${renderSeq++}`, code);
        })
        .then(({ svg: out }) => {
          if (!active) return;
          if (svgCache.size >= SVG_CACHE_MAX) {
            const oldest = svgCache.keys().next().value;
            if (oldest !== undefined) svgCache.delete(oldest);
          }
          svgCache.set(code, out);
          setSvg(out);
          setInvalid(false);
        })
        .catch(() => {
          if (!active) return;
          // Keep the last good SVG during streaming edits; flag otherwise.
          setInvalid(true);
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [code]);

  if (svg) {
    return (
      <>
        <div
          className="modern-mermaid"
          title="Cliquer pour agrandir"
          onClick={(e) => {
            e.stopPropagation();
            onOpen({ kind: "svg", html: svg });
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        {invalid && (
          <div className="modern-mermaid-err">
            {"diagramme en cours d'édition…"}
          </div>
        )}
      </>
    );
  }
  return (
    <>
      <pre>
        <code>{code}</code>
      </pre>
      {invalid && <div className="modern-mermaid-err">diagramme invalide</div>}
    </>
  );
});
