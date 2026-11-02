import { StyleSheet, Text, View } from "react-native";
import type { SFSymbol } from "expo-symbols";
import { activityCounts, type FoldedUnit } from "@/lib/chat/chatGroups";
import type { Subagent } from "@/lib/chat/chatState";
import { outputTail } from "@/lib/chat/chatTasks";
import { bashCutNote } from "@/lib/chat/chatBash";
import { thoughtBody } from "@/lib/chat/chatThoughts";
import type { FeedRow } from "@/lib/chat/phoneFeed";
import { C, MONO, T } from "~/chat/chat-theme";
import { ActivityDetail } from "~/chat/feed/activity-detail";
import { bashEnd } from "~/chat/feed/bash-card";
import type { AgentSheetRender, FeedSheetKind } from "~/chat/feed/feed-env";
import { CHAT_TONE, DIM_TONE, F } from "~/chat/feed/feed-style";
import { MarkdownText } from "~/messages/markdown-text";

/** A whole output in its sheet: its tail past this (the rest is on the PC). */
const OUTPUT_CAP = 30_000;

const tail = (text: string) =>
  text.length > OUTPUT_CAP ? `…\n${text.slice(-OUTPUT_CAP)}` : text;

/** The units an activity sheet unfolds: a reply's wrench, or the row's own. */
const foldedOf = ({ unit, tools }: FeedRow): FoldedUnit[] =>
  tools ??
  (unit.kind === "activity"
    ? unit.units
    : unit.kind === "work" || unit.kind === "edit" || unit.kind === "agent"
      ? [unit]
      : []);

/** The thoughts a sheet reads: a reply's bulb, or the row's own. */
const thoughtsOf = ({ unit, thoughts }: FeedRow) =>
  thoughts ??
  (unit.kind === "thoughts"
    ? unit.items
    : unit.kind === "thinking"
      ? [unit.item]
      : []);

/** A sheet's title and icon, from the row it opens. */
export function sheetHead(
  kind: FeedSheetKind,
  row: FeedRow,
): { title: string; icon: SFSymbol } {
  const { unit } = row;
  switch (kind) {
    case "activity":
      return {
        title:
          activityCounts(foldedOf(row))
            .map((c) => c.label)
            .join(", ") || "Ses outils",
        icon: "wrench.and.screwdriver",
      };
    case "thoughts":
      return { title: "Sa réflexion", icon: "lightbulb" };
    case "plan":
      return { title: "Plan", icon: "list.clipboard" };
    case "command":
      return {
        title: unit.kind === "command" ? `/${unit.item.name}` : "Commande",
        icon: "slash.circle",
      };
    case "bash":
      return {
        title: unit.kind === "bash" ? `! ${unit.item.command}` : "Commande",
        icon: "terminal",
      };
  }
}

/**
 * What a row's sheet holds: an activity line unfolded (or a reply's
 * wrench), the thinking of its stretch (or a reply's bulb), a plan, a
 * command's answer or a `!` command's output, whole. Drawn from the row as
 * it is now: a command still running goes on there.
 */
export function FeedSheetContent({
  kind,
  row,
  cwd,
  subagents,
  agentSheet,
}: {
  kind: FeedSheetKind;
  row: FeedRow;
  /** The chat's folder: tool lines name files from it. */
  cwd: string | null;
  subagents: readonly Subagent[];
  agentSheet?: AgentSheetRender;
}) {
  const { unit, plan } = row;
  switch (kind) {
    case "activity":
      return (
        <ActivityDetail
          units={foldedOf(row)}
          cwd={cwd}
          subagents={subagents}
          agentSheet={agentSheet}
        />
      );
    case "thoughts": {
      const items = thoughtsOf(row);
      return (
        <View style={styles.stack}>
          {items
            .map((i) => thoughtBody(i.text))
            .filter(Boolean)
            .map((body, i) => (
              <Text
                key={i}
                style={[styles.thought, i > 0 && styles.next]}
                selectable
              >
                {body}
              </Text>
            ))}
        </View>
      );
    }
    case "plan":
      return plan ? (
        <MarkdownText markdown={plan} tone={CHAT_TONE} size={T.body} />
      ) : null;
    case "command":
      return unit.kind === "command" && unit.item.output ? (
        <MarkdownText markdown={unit.item.output} tone={DIM_TONE} size={13.5} />
      ) : null;
    case "bash": {
      if (unit.kind !== "bash") return null;
      const { item } = unit;
      const stdout = outputTail(item.stdout, Number.MAX_SAFE_INTEGER);
      const stderr = item.error ?? outputTail(item.stderr, Number.MAX_SAFE_INTEGER);
      const end = bashEnd(item);
      const cut = bashCutNote(item);
      return (
        <View style={styles.stack}>
          {stdout ? (
            <Text style={styles.mono} selectable>
              {tail(stdout)}
            </Text>
          ) : null}
          {stderr ? (
            <Text style={[styles.mono, styles.err]} selectable>
              {tail(stderr)}
            </Text>
          ) : null}
          {item.running ? (
            <Text style={styles.note}>En cours…</Text>
          ) : end ? (
            <Text style={styles.note}>{end}</Text>
          ) : null}
          {cut && <Text style={[styles.note, styles.warn]}>{cut}</Text>}
        </View>
      );
    }
  }
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  // Plain, a rule between two (`.chat-peek-thoughts`).
  thought: { color: "#c4c4cb", fontSize: 14, lineHeight: 21 },
  next: {
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.line,
  },
  mono: { color: C.dim, fontFamily: MONO, fontSize: 11.5, lineHeight: 17 },
  err: { color: F.bad },
  note: { color: C.mute, fontSize: T.small },
  warn: { color: F.warn },
});
