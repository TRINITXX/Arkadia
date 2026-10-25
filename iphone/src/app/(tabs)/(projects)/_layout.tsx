import { Stack } from "expo-router";
import { LARGE_TITLE_SCREEN } from "~/ui/screen-options";

export default function ProjectsLayout() {
  return (
    <Stack screenOptions={LARGE_TITLE_SCREEN}>
      <Stack.Screen name="index" options={{ title: "Projets" }} />
    </Stack>
  );
}
