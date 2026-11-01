import { useEffect, useRef, useState } from "react";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Maximize2,
  Shapes,
  SquareArrowOutUpRight,
  TriangleAlert,
} from "lucide-react";
import { ChatVisualFrame } from "@/components/chat/chat-visual-frame";
import { ChatVisualZoom } from "@/components/chat/chat-visual-zoom";
import { openUrl } from "@/lib/bridge";
import type { ToolItem } from "@/lib/chat/chatGroups";
import {
  visualDocument,
  visualHtml,
  visualInput,
  visualPhase,
  visualProblem,
  visualVerified,
  type VisualEntry,
} from "@/lib/chat/chatVisual";

interface ChatVisualCardProps {
  tool: ToolItem;
  /** What the server said of it (`ChatState.visuals`): its page, its check. */
  entry: VisualEntry | undefined;
  /** A past visual: ask its page with the images in (`visual_html`). */
  onNeedHtml?: (toolUseId: string) => void;
  onChoose?: (text: string) => void;
  onOpenInBrowser?: (html: string, title: string) => void;
}

/** A frame mounts this close to the column's view: a long chat's stay out. */
const NEAR_PX = 800;

/** Visuals the user folded (by call): a card mounted again stays folded. */
const folded = new Set<string>();

/**
 * Claude's visual (`show_visual`) where it was called: a band (title,
 * « Agrandir », « Ouvrir dans le navigateur », « Replier ») over the page,
 * « Replier » again at its foot (the user's ask of 01/11/2026). It shows
 * once Arkadia checked it; one found broken stays folded (Claude sends a
 * fixed one), « Voir quand même » opens it.
 */
export function ChatVisualCard({
  tool,
  entry,
  onNeedHtml,
  onChoose,
  onOpenInBrowser,
}: ChatVisualCardProps) {
  const { title, wide } = visualInput(tool);
  const phase = visualPhase(tool);
  // Nowhere to ask (a subagent's sheet): the call's own page.
  const html =
    visualHtml(tool, entry) ??
    (onNeedHtml ? undefined : visualInput(tool).html);
  const [anyway, setAnyway] = useState(false);
  /** « Agrandir »: the chat pane the view covers, while open. */
  const [zoom, setZoom] = useState<HTMLElement | null>(null);
  const [near, setNear] = useState(false);
  const [fold, setFold] = useState(() => folded.has(tool.id));
  const cardRef = useRef<HTMLDivElement>(null);
  /** Folded from its foot, the card keeps its band in view. */
  const toggleFold = (fromFoot: boolean) => {
    const next = !fold;
    if (next) folded.add(tool.id);
    else folded.delete(tool.id);
    setFold(next);
    if (next && fromFoot)
      requestAnimationFrame(() =>
        cardRef.current?.scrollIntoView({ block: "nearest" }),
      );
  };
  const foldButton = (fromFoot: boolean) => (
    <button
      type="button"
      className="chat-visual-btn"
      aria-expanded={!fold}
      onClick={() => toggleFold(fromFoot)}
    >
      {fold ? <ChevronsUpDown /> : <ChevronsDownUp />}
      <span className="lbl">{fold ? "Déplier" : "Replier"}</span>
    </button>
  );
  // A past call: its page with the images in is the server's to say.
  const needs = html === undefined && phase !== "checking";
  useEffect(() => {
    if (needs) onNeedHtml?.(tool.id);
  }, [needs, onNeedHtml, tool.id]);
  // Mounted once near the view, then kept (its page keeps its state).
  useEffect(() => {
    const card = cardRef.current;
    if (near || !card) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { root: card.closest(".chat-scroll"), rootMargin: `${NEAR_PX}px 0px` },
    );
    io.observe(card);
    return () => io.disconnect();
  }, [near]);

  if (phase === "broken" && !anyway) {
    return (
      <div className="chat-line static chat-visual-broken" ref={cardRef}>
        <TriangleAlert />
        <b>Visuel « {title} » écarté</b>
        <span className="why" title={tool.result?.text}>
          · {visualProblem(tool)}
        </span>
        {html && (
          <button
            type="button"
            className="chat-visual-btn"
            onClick={() => setAnyway(true)}
          >
            Voir quand même
          </button>
        )}
      </div>
    );
  }
  const ready = phase !== "checking" && html !== undefined;
  const open = () => {
    if (html) onOpenInBrowser?.(visualDocument(html), title);
  };
  const link = (url: string) => void openUrl(url).catch(() => {});
  return (
    <div
      className={`chat-visual${wide ? " wide" : ""}`}
      ref={cardRef}
      data-mark="visual"
      data-preview={title}
    >
      <div className="chat-visual-head">
        <Shapes />
        <span className="t">{title}</span>
        {!ready && <span className="spin" />}
        {ready && (
          <span className="tail">
            <button
              type="button"
              className="chat-visual-btn"
              onClick={() =>
                setZoom(
                  cardRef.current?.closest<HTMLElement>(".chat-root") ?? null,
                )
              }
            >
              <Maximize2 />
              <span className="lbl">Agrandir</span>
            </button>
            {onOpenInBrowser && (
              <button type="button" className="chat-visual-btn" onClick={open}>
                <SquareArrowOutUpRight />
                <span className="lbl">Ouvrir dans le navigateur</span>
              </button>
            )}
            {foldButton(false)}
          </span>
        )}
      </div>
      {ready && fold ? null : ready && near && html ? (
        <ChatVisualFrame
          html={html}
          title={title}
          verified={visualVerified(tool)}
          onChoose={onChoose}
          onLink={link}
        />
      ) : (
        <div className="chat-visual-wait">
          {phase === "checking"
            ? "Arkadia vérifie le visuel…"
            : "Chargement du visuel…"}
        </div>
      )}
      {ready && !fold && near && html && (
        <div className="chat-visual-foot">{foldButton(true)}</div>
      )}
      {zoom && html && (
        <ChatVisualZoom
          html={html}
          title={title}
          host={zoom}
          onClose={() => setZoom(null)}
          onChoose={onChoose}
          onLink={link}
          onOpenInBrowser={onOpenInBrowser ? open : undefined}
        />
      )}
    </div>
  );
}
