import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { FoldedUnit } from "@/lib/chat/chatGroups";
import type { Subagent } from "@/lib/chat/chatState";
import { AgentRow } from "~/chat/feed/agent-row";
import { EditCard } from "~/chat/feed/edit-card";
import type { AgentSheetRender } from "~/chat/feed/feed-env";
import { WorkGroup } from "~/chat/feed/work-group";
import { tap } from "~/ui/haptics";

/**
 * An activity line unfolded in its sheet, as the desktop unfolds it in the
 * column: tool runs, file changes, subagents. A subagent's conversation
 * opens over this sheet, from it.
 */
export function ActivityDetail({
  units,
  cwd,
  subagents,
  agentSheet,
}: {
  units: FoldedUnit[];
  /** The chat's folder: tool lines and file changes name files from it. */
  cwd: string | null;
  /** The chat's subagents: a row whose agent is known opens it. */
  subagents: readonly Subagent[];
  /** Absent: no conversation opens (a subagent's own feed). */
  agentSheet?: AgentSheetRender;
}) {
  // Kept while its sheet slides away: it doesn't empty as it goes.
  const [agent, setAgent] = useState<Subagent | null>(null);
  const [shown, setShown] = useState(false);
  const open = useCallback((a: Subagent) => {
    tap();
    setAgent(a);
    setShown(true);
  }, []);
  const close = useCallback(() => setShown(false), []);
  return (
    <View style={styles.units}>
      {units.map((unit) => {
        if (unit.kind === "work")
          return <WorkGroup key={unit.id} tools={unit.tools} cwd={cwd} />;
        if (unit.kind === "edit")
          return <EditCard key={unit.item.id} tool={unit.item} cwd={cwd} />;
        return (
          <AgentRow
            key={unit.item.id}
            tool={unit.item}
            agent={subagents.find((s) => s.toolUseId === unit.item.id)}
            onOpen={agentSheet ? open : undefined}
          />
        );
      })}
      {agentSheet?.(agent, shown, close)}
    </View>
  );
}

const styles = StyleSheet.create({ units: { gap: 14 } });
