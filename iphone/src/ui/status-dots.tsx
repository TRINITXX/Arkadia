import { StyleSheet, Text, View } from "react-native";
import type { AccountMark } from "@/lib/accounts";
import type { RemoteBadge } from "@/lib/remoteSnapshot";
import { accountShortLabel, badgeColor } from "~/remote/snapshot";

/** The desktop's agent badge: amber = Claude works, green = it waits for you. */
export function BadgeDot({ badge }: { badge: RemoteBadge }) {
  const color = badgeColor(badge);
  if (!color) return null;
  return (
    <View
      style={[styles.badge, { backgroundColor: color, shadowColor: color }]}
    />
  );
}

/** The Claude account a tab runs on, by its number. */
export function AccountChip({ account }: { account: AccountMark | null }) {
  if (!account) return null;
  return (
    <Text style={[styles.account, { backgroundColor: account.color }]}>
      {accountShortLabel(account.label)}
    </Text>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    shadowOpacity: 0.6,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 0 },
  },
  account: {
    overflow: "hidden",
    borderRadius: 5,
    paddingHorizontal: 5,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
    color: "#000000",
  },
});
