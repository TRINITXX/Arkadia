import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

/** A window rect in physical pixels (`pip_follow.rs`). */
export interface PipRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface PipFollowStatus {
  /** Only the daily Arkadia moves the Twitch PiP window, never the Lab. */
  enabled: boolean;
  target: PipRect | null;
}

/** What the last button press did, for the line under the buttons. */
export type PipFollowNote = "saved" | "noPip" | "cleared" | "failed" | null;

/**
 * The place the Twitch PiP window goes to while Arkadia is in front
 * (`pip_follow.rs`), saved from where the window is now.
 */
export function usePipFollow() {
  const [status, setStatus] = useState<PipFollowStatus | null>(null);
  const [note, setNote] = useState<PipFollowNote>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    invoke<PipFollowStatus>("pip_follow_status")
      .then((s) => {
        if (mounted.current) setStatus(s);
      })
      .catch(() => {});
    return () => {
      mounted.current = false;
    };
  }, []);

  const save = async () => {
    try {
      const target = await invoke<PipRect | null>("pip_follow_save_target");
      if (!mounted.current) return;
      if (!target) {
        setNote("noPip");
        return;
      }
      setStatus((s) => (s ? { ...s, target } : s));
      setNote("saved");
    } catch {
      if (mounted.current) setNote("failed");
    }
  };

  const clear = async () => {
    try {
      await invoke("pip_follow_clear_target");
      if (!mounted.current) return;
      setStatus((s) => (s ? { ...s, target: null } : s));
      setNote("cleared");
    } catch {
      if (mounted.current) setNote("failed");
    }
  };

  return {
    enabled: status?.enabled ?? false,
    target: status?.target ?? null,
    note,
    save,
    clear,
  };
}
