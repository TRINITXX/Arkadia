import { useEffect, useRef, useState } from "react";
import type { EffortLevel } from "@/lib/chat/chatProtocol";
import { effortLabel } from "@/lib/chat/chatSdkSettings";

/** Past this, a level Claude Code never confirmed gives way to its own. */
const CONFIRM_MS = 3_000;

/** The keys that move a range input. */
const MOVE_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/**
 * The session's effort as a slider (the user's pick of 31/10/2026), one stop
 * per level the model takes, low to max. Dragging shows the level; it
 * applies when released (pointer or key), not at every stop. The level sent
 * stays shown until Claude Code reports it, so the thumb never jumps back.
 */
export function ChatEffortSlider({
  levels,
  value,
  onChange,
}: {
  levels: EffortLevel[];
  value: EffortLevel | null;
  onChange: (level: EffortLevel) => void;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const [sent, setSent] = useState<EffortLevel | null>(null);
  // Only a gesture on the slider itself applies: Tab's keyup lands here too.
  const armed = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const base = sent !== null && sent !== value ? sent : value;
  const baseIndex = base ? levels.indexOf(base) : -1;
  const at = drag ?? baseIndex;
  const shown = at >= 0 ? levels[at] : null;
  const last = levels.length - 1;

  const commit = (input: HTMLInputElement) => {
    if (!armed.current) return;
    armed.current = false;
    setDrag(null);
    const level = levels[Number(input.value)];
    if (!level || level === base) return;
    onChange(level);
    setSent(level);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSent(null), CONFIRM_MS);
  };
  return (
    <div className="chat-effort-slider">
      <div className="hd">
        <h6>Effort</h6>
        {shown && <b>{effortLabel(shown)}</b>}
      </div>
      <input
        type="range"
        // No level known: no thumb, and any stop can be picked.
        className={at < 0 ? "unset" : undefined}
        min={0}
        max={last}
        step={1}
        value={Math.max(at, 0)}
        aria-label="Effort"
        aria-valuetext={shown ? effortLabel(shown) : "inconnu"}
        style={
          {
            "--pct": `${at > 0 && last > 0 ? (at / last) * 100 : 0}%`,
          } as React.CSSProperties
        }
        onPointerDown={() => (armed.current = true)}
        onKeyDown={(e) => {
          if (MOVE_KEYS.has(e.key)) armed.current = true;
        }}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={(e) => commit(e.currentTarget)}
        onKeyUp={(e) => commit(e.currentTarget)}
        onBlur={(e) => commit(e.currentTarget)}
      />
      <div className="ends">
        <span>{effortLabel(levels[0])}</span>
        <span>{effortLabel(levels[last])}</span>
      </div>
    </div>
  );
}
