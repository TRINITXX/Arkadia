import type { ComponentProps } from "react";
import type { Stack } from "expo-router";

type StackOptions = NonNullable<ComponentProps<typeof Stack>["screenOptions"]>;

/**
 * A tab's list screen: Apple's large title, the list passing under the bar
 * with iOS 26's own edge effect. No `headerBlurEffect`: on iOS 26 it lays a
 * second blur over that effect and hides the title (seen on 25/10/2026).
 */
export const LARGE_TITLE_SCREEN: StackOptions = {
  headerLargeTitleEnabled: true,
  headerTransparent: true,
  headerTintColor: "#ffffff",
  contentStyle: { backgroundColor: "#000000" },
};
