import { useMemo, useState } from "react";
import {
  Check,
  ChevronUp,
  FilePen,
  Map as MapIcon,
  ShieldAlert,
  ShieldQuestion,
  Zap,
} from "lucide-react";
import {
  MODELS,
  MODE_CYCLE,
  modeLabel,
  modelLabel,
} from "@/lib/chat/chatLabels";
import type { EffortLevel, PermissionMode } from "@/lib/chat/chatProtocol";
import {
  currentChoice,
  effortChoices,
  effortLabel,
  type ModelChoice,
  type SdkState,
} from "@/lib/chat/chatSdkSettings";
import { useChatLayer } from "@/lib/chat/useChatLayers";

/** Until Claude Code lists its models: the usual four. */
const FALLBACK: ModelChoice[] = MODELS.map((m) => ({
  value: m.id,
  model: m.id,
  label: m.label,
  efforts: [],
  fast: false,
}));

const MODE_ICONS: Record<string, typeof Zap> = {
  default: ShieldQuestion,
  acceptEdits: FilePen,
  plan: MapIcon,
  auto: Zap,
  bypassPermissions: ShieldAlert,
};

/**
 * One button, first in the input's bottom row (the user's pick of
 * 31/10/2026): the model's name, the effort small under it. It opens one
 * menu for the model (Claude Code's own list), the effort it takes (this
 * session only) and the mode (Maj+Tab in the input still cycles it).
 */
export function ChatSessionMenu({
  mode,
  model,
  sdk,
  onMode,
  onModel,
  onEffort,
}: {
  mode: string | null;
  model: string | null;
  sdk: Pick<SdkState, "models" | "effort" | "fastMode">;
  onMode: (mode: PermissionMode) => void;
  onModel: (model: string) => void;
  /** The session's effort, this session only. */
  onEffort?: (effort: EffortLevel) => void;
}) {
  const [open, setOpen] = useState(false);
  const models = sdk.models.length > 0 ? sdk.models : FALLBACK;
  const current = useMemo(() => currentChoice(models, model), [models, model]);
  const efforts = effortChoices({
    models: sdk.models,
    model,
    effort: sdk.effort,
  });
  // Esc closes the menu, never Claude's turn (`chatLayers`).
  useChatLayer(open, () => setOpen(false));
  return (
    <span className="chat-anchor">
      <button
        type="button"
        className={`chat-session-btn${open ? " open" : ""}`}
        title={`Modèle, effort et mode (${modeLabel(mode)})`}
        onClick={() => setOpen((o) => !o)}
      >
        <b>
          {current?.label ?? modelLabel(model)} <ChevronUp />
        </b>
        {(sdk.effort || sdk.fastMode) && (
          <small>
            {sdk.effort && effortLabel(sdk.effort)}
            {/* Fast mode stays in sight, as its chip was. */}
            {sdk.fastMode && (
              <span className={`fast ${sdk.fastMode}`}>
                {" "}
                ↯ {sdk.fastMode === "on" ? "rapide" : "en pause"}
              </span>
            )}
          </small>
        )}
      </button>
      {open && (
        <div
          className="chat-menu chat-session-menu"
          style={{ left: 0 }}
          // On the menu, not the button: the pointer crosses a gap to it.
          onMouseLeave={() => setOpen(false)}
        >
          <h6>Modèle</h6>
          <div className="chat-session-models">
            {models.map((m) => (
              <button
                key={m.value}
                type="button"
                className={m === current ? "on" : undefined}
                onClick={() => onModel(m.value)}
              >
                {m.label}
                {m === current && <Check className="ck" />}
              </button>
            ))}
          </div>
          {efforts.length > 0 && onEffort && (
            <>
              <h6>Effort</h6>
              <div className="chat-session-seg">
                {efforts.map((level) => (
                  <button
                    key={level}
                    type="button"
                    aria-pressed={level === sdk.effort}
                    className={level === sdk.effort ? "on" : undefined}
                    title={level}
                    onClick={() => onEffort(level)}
                  >
                    {effortLabel(level)}
                  </button>
                ))}
              </div>
            </>
          )}
          <h6>Mode</h6>
          <div className="chat-session-modes">
            {MODE_CYCLE.map((m) => {
              const Icon = MODE_ICONS[m] ?? Zap;
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={m === mode}
                  className={m === mode ? "on" : undefined}
                  onClick={() => onMode(m)}
                >
                  <Icon /> {modeLabel(m)}
                </button>
              );
            })}
          </div>
          {sdk.fastMode && (
            <p className="chat-session-fast">
              ↯{" "}
              {sdk.fastMode === "on"
                ? "Mode rapide activé (/fast pour l'arrêter)"
                : "Mode rapide en pause après une limite d'usage"}
            </p>
          )}
        </div>
      )}
    </span>
  );
}
