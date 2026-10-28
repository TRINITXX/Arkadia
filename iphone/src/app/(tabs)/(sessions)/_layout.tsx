import { Stack } from "expo-router";
import { LARGE_TITLE_SCREEN } from "~/ui/screen-options";

export default function SessionsLayout() {
  return (
    <Stack screenOptions={LARGE_TITLE_SCREEN}>
      <Stack.Screen name="sessions" options={{ title: "Sessions" }} />
    </Stack>
  );
}
