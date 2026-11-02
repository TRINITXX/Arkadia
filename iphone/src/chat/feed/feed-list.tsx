import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { FlatList, StyleSheet, type ListRenderItemInfo } from "react-native";
import { runningBash } from "@/lib/chat/chatBash";
import { peerLabel } from "@/lib/chat/chatPeer";
import type { ChatState } from "@/lib/chat/chatState";
import type { FeedRow } from "@/lib/chat/phoneFeed";
import type {
  AgentSheetRender,
  FeedEnv,
  FeedSheetRef,
} from "~/chat/feed/feed-env";
import { FeedGap } from "~/chat/feed/feed-gap";
import { FeedRowView } from "~/chat/feed/feed-row";
import { FeedSheet } from "~/chat/feed/feed-sheet";
import { FeedSheetContent, sheetHead } from "~/chat/feed/feed-sheet-content";
import type { ChatActions } from "~/chat/use-chat";

const rowKey = (row: FeedRow) => row.key;
const NO_IDS: readonly string[] = [];

/**
 * The newest row stays in place when rows come under it while the reader
 * is up the conversation; at its end, the feed follows what comes.
 */
const FOLLOW = { minIndexForVisible: 0, autoscrollToTopThreshold: 48 };

/**
 * A conversation's rows in an inverted list, newest at the bottom, and the
 * sheets its rows open (one at a time, its content following the row).
 * The chat's own feed, or a subagent's in its sheet (`acts` off: read only).
 */
export function FeedList({
  chatId,
  state,
  rows,
  actions,
  onChoose,
  acts,
  top,
  bottom,
  agentSheet,
  bareIds = NO_IDS,
}: {
  chatId: string;
  /** The conversation the rows are of: its requests, subagents, visuals. */
  state: ChatState;
  /** Newest first (`feedRows`). */
  rows: FeedRow[];
  actions: ChatActions;
  onChoose: (text: string) => void;
  acts: boolean;
  /** Above the oldest row: « Charger les messages plus anciens ». */
  top?: ReactElement | null;
  /** Under the newest row: the chat's end and its « Reprendre ». */
  bottom?: ReactElement | null;
  agentSheet?: AgentSheetRender;
  /** Claude's replies whose questions the round's sheet shows (`useRoundShown`). */
  bareIds?: readonly string[];
}) {
  // The sheet keeps its row while it slides away: it doesn't empty as it goes.
  const [sheet, setSheet] = useState<FeedSheetRef | null>(null);
  const [shown, setShown] = useState(false);
  const open = useCallback((ref: FeedSheetRef) => {
    setSheet(ref);
    setShown(true);
  }, []);
  const close = useCallback(() => setShown(false), []);
  // Read when a visual chooses: a parent's new arrow each render would
  // draw every row again (`FeedRowView` compares `env`).
  const chooseRef = useRef(onChoose);
  useEffect(() => {
    chooseRef.current = onChoose;
  });
  const choose = useCallback((text: string) => chooseRef.current(text), []);
  const env = useMemo<FeedEnv>(
    () => ({ chatId, actions, onChoose: choose, acts, open }),
    [chatId, actions, choose, acts, open],
  );

  const closed = state.closed !== null;
  // Held behind a running `!` command, a queued message goes when it ends:
  // stopping Claude's turn wouldn't send it.
  const bashBusy = useMemo(() => runningBash(state.items) !== null, [state.items]);
  const pendingIds = useMemo(
    () => new Set(state.requests.map((r) => r.toolUseId)),
    [state.requests],
  );
  const renderItem = useCallback(
    ({ item: row }: ListRenderItemInfo<FeedRow>) => {
      const { unit } = row;
      const queued =
        (unit.kind === "user" || unit.kind === "command") && !!unit.item.queued;
      return (
        <FeedRowView
          row={row}
          env={env}
          sendNow={queued && acts && !closed && !bashBusy}
          withdraw={queued && acts && !closed}
          bare={unit.kind === "text" && bareIds.includes(unit.item.id)}
          pending={
            (unit.kind === "question" || unit.kind === "plan") &&
            pendingIds.has(unit.item.id)
          }
          label={
            unit.kind === "peer" ? peerLabel(unit.item, state.subagents) : undefined
          }
          visual={unit.kind === "visual" ? state.visuals[unit.item.id] : undefined}
          state={state}
        />
      );
    },
    [env, acts, closed, bashBusy, pendingIds, bareIds, state],
  );

  const row = sheet ? rows.find((r) => r.key === sheet.key) : undefined;
  const head = sheet && row ? sheetHead(sheet.kind, row.unit) : null;
  return (
    <>
      <FlatList
        inverted
        data={rows}
        keyExtractor={rowKey}
        renderItem={renderItem}
        ItemSeparatorComponent={FeedGap}
        // Inverted: the header draws under the newest row, the footer above
        // the oldest.
        ListHeaderComponent={bottom ?? undefined}
        ListFooterComponent={top ?? undefined}
        contentContainerStyle={styles.list}
        maintainVisibleContentPosition={FOLLOW}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        indicatorStyle="white"
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={13}
      />
      {sheet && row && head && (
        <FeedSheet
          visible={shown}
          title={head.title}
          icon={head.icon}
          onClose={close}
        >
          <FeedSheetContent
            kind={sheet.kind}
            unit={row.unit}
            plan={row.plan}
            subagents={state.subagents}
            agentSheet={agentSheet}
          />
        </FeedSheet>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 14, paddingVertical: 12 },
});
