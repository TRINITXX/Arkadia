import { useMemo, useState } from "react";
import { Gauge } from "lucide-react";
import { MODELS, modelLabel } from "@/lib/chat/chatLabels";
import type { EffortLevel } from "@/lib/chat/chatProtocol";
import {
  currentChoice,
  effortChoices,
  effortLabel,
  type ModelChoice,
  type SdkState,
} from "@/lib/chat/chatSdkSettings";

/** Until Claude Code lists its models: the usual four. */
const FALLBACK: ModelChoice[] = MODELS.map((m) => ({
  value: m.id,
  model: m.id,
  label: m.label,
  efforts: [],
  fast: false,
}));

/**
 * The input's model chip and, beside it, the effort chip and the fast mode
 * mark. The model menu is Claude Code's own list (`supportedModels`, the 1M
 * window rows included); the effort menu offers what the model takes, for
 * this session only (`applyFlagSettings`), and hides for a model without.
 */
export function ChatModelPicker({
  model,
  sdk,
  onModel,
  onEffort,
  onMenu,
}: {
  model: string | null;
  sdk: Pick<SdkState, "models" | "effort" | "fastMode">;
  onModel: (model: string) => void;
  onEffort?: (effort: EffortLevel) => void;
  /** A menu of its opened or closed (the input's Tab waits for none open). */
  onMenu?: (open: boolean) => void;
}) {
  const [menu, setMenuState] = useState<"model" | "effort" | null>(null);
  const setMenu = (value: "model" | "effort" | null) => {
    if (Boolean(value) !== Boolean(menu)) onMenu?.(Boolean(value));
    setMenuState(value);
  };
  const models = sdk.models.length > 0 ? sdk.models : FALLBACK;
  const current = useMemo(() => currentChoice(models, model), [models, model]);
  const efforts = effortChoices({
    models: sdk.models,
    model,
    effort: sdk.effort,
  });
  const toggle = (which: "model" | "effort") =>
    setMenu(menu === which ? null : which);
  return (
    <>
      <span className="chat-anchor">
        <span
          className="chat-chip"
          title="Changer de modèle"
          onClick={() => toggle("model")}
        >
          <span className="lbl">{current?.label ?? modelLabel(model)}</span>
        </span>
        {menu === "model" && (
          <div
            className="chat-menu chat-model-menu"
            style={{ left: 0 }}
            onMouseLeave={() => setMenu(null)}
          >
            {models.map((m) => (
              <button
                key={m.value}
                type="button"
                className={m === current ? "on" : undefined}
                onClick={() => {
                  onModel(m.value);
                  setMenu(null);
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </span>
      {sdk.fastMode && (
        <span
          className={`chat-fast${sdk.fastMode === "cooldown" ? " cooldown" : ""}`}
          title={
            sdk.fastMode === "on"
              ? "Mode rapide activé (/fast pour l'arrêter)"
              : "Mode rapide en pause après une limite d'usage"
          }
        >
          ↯ {sdk.fastMode === "on" ? "rapide" : "rapide en pause"}
        </span>
      )}
      {efforts.length > 0 && onEffort && (
        <span className="chat-anchor">
          <span
            className="chat-chip"
            title="Effort de réflexion, pour cette session seulement"
            onClick={() => toggle("effort")}
          >
            <Gauge />{" "}
            <span className="lbl">
              {sdk.effort ? effortLabel(sdk.effort) : "Effort"}
            </span>
          </span>
          {menu === "effort" && (
            <div
              className="chat-menu chat-effort-menu"
              style={{ left: 0 }}
              onMouseLeave={() => setMenu(null)}
            >
              {efforts.map((level) => (
                <button
                  key={level}
                  type="button"
                  className={level === sdk.effort ? "on" : undefined}
                  onClick={() => {
                    onEffort(level);
                    setMenu(null);
                  }}
                >
                  {effortLabel(level)}
                  <span className="hint">{level}</span>
                </button>
              ))}
            </div>
          )}
        </span>
      )}
    </>
  );
}
