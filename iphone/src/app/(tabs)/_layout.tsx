import { NativeTabs } from "expo-router/native-tabs";

// Apple's tab bar: Projets, Sessions, Comptes (choice of 25/10/2026). Only
// Projets has an `index`: the app opens on the list that owns "/", and with
// three of them the first folder by name won, Comptes (an `anchor` does not
// change that, checked on 28/10/2026).
// Expo Router needs the layout as the module's default export.
export default function TabsLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="(projects)">
        <NativeTabs.Trigger.Icon sf="list.bullet.rectangle" />
        <NativeTabs.Trigger.Label>Projets</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(sessions)">
        <NativeTabs.Trigger.Icon sf="clock.arrow.circlepath" />
        <NativeTabs.Trigger.Label>Sessions</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(accounts)">
        <NativeTabs.Trigger.Icon sf="person.2" />
        <NativeTabs.Trigger.Label>Comptes</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
