import { useEffect, useRef, useState, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  closeArtifactByKey,
  opencliKey,
  showOpenCli,
  type ArtifactChange,
  type ArtifactsByTab,
} from "@/lib/artifactTabs";
import { subscribeStable } from "@/lib/tauriEvents";
import type { Tab } from "@/types";

const PREFIX = "opencli:";

/**
 * OpenCLI's Chrome window (X and Reddit) in an « X / Reddit » tab of the
 * panel (`chrome_view.rs`). An opencli command asks for it first
 * (`opencli-request`, from `~/.claude/hooks/opencli-panel.mjs`). One window
 * for every session: it shows in the tab of the session that ran a command
 * last (`opencli-owner`), another session's tab says it is used elsewhere.
 * A pane's tab comes forward by itself once OpenCLI browses for it
 * (`opencli-ready`), once: closed, it stays closed. The pane gone, its tab
 * leaves and the window stays open, parked, for OpenCLI. Returns the
 * owner's item key.
 */
export function useOpenCliPanel(
  tabs: Tab[],
  loaded: boolean,
  tabsRef: RefObject<Tab[]>,
  changeArtifacts: (change: (state: ArtifactsByTab) => ArtifactChange) => void,
  onError: (message: string) => void,
): string | null {
  const [owner, setOwner] = useState<string | null>(null);
  // Panes that asked: their tab leaves with them (the window stays).
  const panes = useRef(new Set<string>());
  // Panes whose tab came forward by itself since this page loaded.
  const shownOnce = useRef(new Set<string>());
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    // A reloaded page (watchdog repair) learns the owner again: asked once
    // its event is listened to, and ignored when one told a newer owner.
    let alive = true;
    let heard = false;
    let stopOwner: (() => void) | undefined;
    void listen<{ key: string | null }>("opencli-owner", (e) => {
      heard = true;
      if (alive) setOwner(e.payload.key);
    })
      .then((stop) => {
        if (!alive) {
          stop();
          return;
        }
        stopOwner = stop;
        return invoke<string | null>("opencli_view_owner").then((key) => {
          if (!alive || heard || !key?.startsWith(PREFIX)) return;
          panes.current.add(key.slice(PREFIX.length));
          setOwner(key);
        });
      })
      .catch(() => {});
    const owns = (paneId: string) => (t: Tab) =>
      Object.prototype.hasOwnProperty.call(t.panes, paneId);
    const stops = [
      () => stopOwner?.(),
      subscribeStable<{ id: string; paneId: string }>(
        listen,
        "opencli-request",
        ({ id, paneId }) => {
          // Another Arkadia's pane (`tauri dev` shares the folder): its own
          // instance answers.
          if (!tabsRef.current?.some(owns(paneId))) return;
          panes.current.add(paneId);
          invoke("opencli_view_prepare", {
            id,
            key: opencliKey(paneId),
          }).catch((e) => onErrorRef.current(`X / Reddit : ${String(e)}`));
        },
      ),
      // OpenCLI took one of its windows to a page: not on a command that
      // opens none (`opencli profile list`, the ready script).
      subscribeStable<{ key: string }>(listen, "opencli-ready", ({ key }) => {
        if (!key.startsWith(PREFIX)) return;
        const paneId = key.slice(PREFIX.length);
        if (shownOnce.current.has(paneId)) return;
        const tab = tabsRef.current?.find(owns(paneId));
        if (!tab) return;
        shownOnce.current.add(paneId);
        changeArtifacts((state) => ({
          state: showOpenCli(state, tab.id, paneId),
          closed: [],
        }));
      }),
    ];
    return () => {
      alive = false;
      stops.forEach((stop) => stop());
    };
  }, [tabsRef, changeArtifacts]);

  // Whatever closed a pane, it leaves `tabs`: its tab goes, the window stays.
  useEffect(() => {
    // Before the saved tabs are back, every pane looks gone.
    if (!loaded || panes.current.size === 0) return;
    const live = new Set(tabs.flatMap((t) => Object.keys(t.panes)));
    for (const paneId of [...panes.current]) {
      if (live.has(paneId)) continue;
      panes.current.delete(paneId);
      const key = opencliKey(paneId);
      void invoke("opencli_view_close", { key }).catch(() => {});
      changeArtifacts((state) => closeArtifactByKey(state, key));
    }
  }, [tabs, loaded, owner, changeArtifacts]);

  return owner;
}
