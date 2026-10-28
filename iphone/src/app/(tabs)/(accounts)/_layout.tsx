import { Stack } from "expo-router";
import { LARGE_TITLE_SCREEN } from "~/ui/screen-options";

export default function AccountsLayout() {
  return (
    <Stack screenOptions={LARGE_TITLE_SCREEN}>
      <Stack.Screen name="accounts" options={{ title: "Comptes" }} />
    </Stack>
  );
}
