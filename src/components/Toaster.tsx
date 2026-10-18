import { useCallback, useState } from "react";
import type { Toast } from "../types";
import { makeToast, toastTtl } from "../lib/toast";

/** Toast state + a `pushToast` action. The auto-dismiss timer lives here; the
 *  pure id/level/ttl logic is in `../lib/toast` (unit-tested under Node). */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pushToast = useCallback((level: "info" | "error", message: string) => {
    const toast = makeToast(level, message);
    setToasts((prev) => [...prev, toast]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    }, toastTtl(level));
  }, []);
  return { toasts, pushToast };
}

/** `right`: distance from the window's right edge, wider while the artifact
 *  panel (a separate window that would cover the toasts) is open. */
export function Toaster({
  toasts,
  right = 16,
}: {
  toasts: Toast[];
  right?: number;
}) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        right,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 9999,
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            fontSize: 13,
            color: "#fff",
            background: t.level === "error" ? "#b00020" : "#1f2937",
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
            maxWidth: 420,
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
