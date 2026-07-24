import { useEffect } from "react";
import type { LightboxContent } from "@/components/modern/ImageThumb";

interface LightboxProps {
  content: LightboxContent;
  onClose: () => void;
}

/**
 * Full-screen zoom overlay for images and mermaid SVGs. Follows the app's
 * overlay idiom (fixed inset-0, no portal). Keyboard is captured on `window`
 * while open so Escape (and anything else) never leaks into the focused
 * terminal's PTY.
 */
export function Lightbox({ content, onClose }: LightboxProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="modern-lightbox" onClick={onClose}>
      {content.kind === "image" ? (
        <img
          src={content.url}
          alt=""
          onClick={(e) => e.stopPropagation()}
          style={{ cursor: "default" }}
        />
      ) : (
        <div
          className="svgbox"
          onClick={(e) => e.stopPropagation()}
          style={{ cursor: "default" }}
          dangerouslySetInnerHTML={{ __html: content.html }}
        />
      )}
    </div>
  );
}
