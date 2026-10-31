import { Zap } from "lucide-react";
import { ChatModelPicker } from "@/components/chat/chat-model-picker";
import { modeLabel, nextMode } from "@/lib/chat/chatLabels";
import type { EffortLevel, PermissionMode } from "@/lib/chat/chatProtocol";
import type { SdkState } from "@/lib/chat/chatSdkSettings";

/**
 * The session's mode, model and effort, first on the status line under the
 * input (the user's ask of 31/10/2026): the model is the button that changes
 * it, the mode cycles on click (Maj+Tab in the input too).
 */
export function ChatSessionControls({
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
  return (
    <>
      <ChatModelPicker
        model={model}
        sdk={sdk}
        onModel={onModel}
        onEffort={onEffort}
      />
      <span
        className="chat-chip"
        title="Changer de mode (Maj+Tab)"
        onClick={() => onMode(nextMode(mode))}
      >
        <Zap /> <span className="lbl">{modeLabel(mode)}</span>
      </span>
    </>
  );
}
