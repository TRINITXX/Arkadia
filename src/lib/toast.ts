import type { Toast } from "../types";

let toastSeq = 0;

/** Creates a Toast with a process-unique id. */
export function makeToast(level: "info" | "error", message: string): Toast {
  return { id: `toast-${++toastSeq}`, level, message };
}

/** Auto-dismiss delay (ms): errors linger longer than infos. */
export function toastTtl(level: "info" | "error"): number {
  return level === "error" ? 8000 : 5000;
}
