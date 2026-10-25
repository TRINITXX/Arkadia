import type { ComponentProps } from "react";
import type { Stack } from "expo-router";

type StackOptions = NonNullable<ComponentProps<typeof Stack>["screenOptions"]>;

/** A tab's list screen: Apple's large title over a black background. */
export const LARGE_TITLE_SCREEN: StackOptions = {
  headerLargeTitle: true,
  headerTransparent: true,
  headerBlurEffect: "systemChromeMaterialDark",
  headerTintColor: "#ffffff",
  contentStyle: { backgroundColor: "#000000" },
};
