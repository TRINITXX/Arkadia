import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useLiveActivity } from "~/activity/use-live-activity";
import { LockScreen } from "~/lock/lock-screen";
import { useAppLock } from "~/lock/use-app-lock";
import { usePushNotifications } from "~/notifications/use-push-notifications";
import { startRemote, useRemoteView } from "~/remote/connection";
import { useReach } from "~/remote/reach";
import { ReachScreen } from "~/reach/reach-screen";
import { NoticeBanner } from "~/ui/notice-banner";

// Expo Router needs the layout as the module's default export.
export default function RootLayout() {
  useEffect(() => startRemote(), []);
  const { status, snapshot } = useRemoteView();
  usePushNotifications(snapshot);
  useLiveActivity(snapshot);
  const { reach, wake } = useReach();
  const lock = useAppLock();
  // Down for a known reason (or waking it): a screen that says so. A plain
  // reconnection keeps the last screen, with its own small notice.
  const down = status !== "open" && (reach !== "unknown" || wake !== null);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: "#000000" },
          headerTintColor: "#ffffff",
          // Left unset, iOS 26 draws a see-through Liquid Glass bar and the
          // terminal's first rows slide under it (seen on 28/10/2026).
          headerTransparent: false,
          headerShadowVisible: false,
          headerStyle: { backgroundColor: "#000000" },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="tab/[id]" options={{ title: "" }} />
        <Stack.Screen
          name="pick"
          options={{
            headerShown: false,
            presentation: "formSheet",
            sheetAllowedDetents: [0.75, 1],
            sheetGrabberVisible: true,
            contentStyle: { backgroundColor: "#1c1c1e" },
          }}
        />
      </Stack>
      {down && (
        <View style={styles.cover}>
          <ReachScreen reach={reach} wake={wake} />
        </View>
      )}
      <NoticeBanner />
      {lock.locked && <LockScreen onUnlock={() => void lock.unlock()} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000000" },
  cover: { ...StyleSheet.absoluteFill, zIndex: 50 },
});
