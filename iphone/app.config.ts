import type { ExpoConfig, ConfigContext } from "expo/config";

// iPhone only: Alexis drives Arkadia from his iPhone, the old PC keeps the web page.
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Arkadia",
  slug: "arkadia",
  scheme: "arkadia",
  // runtimeVersion follows this version: bump it with every native change, so
  // over-the-air updates never reach a build that lacks their native modules.
  version: "0.1.0",
  // Also at the top level: EAS Update reads it there (same value as iOS's).
  runtimeVersion: { policy: "appVersion" },
  updates: {
    url: "https://u.expo.dev/2bb93e11-a0fa-4145-a7e1-4336a84154d5",
  },
  orientation: "portrait",
  icon: "./assets/icon.png",
  // Always dark, like the desktop (Alexis's choice of 25/10/2026).
  userInterfaceStyle: "dark",
  backgroundColor: "#000000",
  platforms: ["ios"],
  ios: {
    supportsTablet: false,
    bundleIdentifier: "com.trinitx.arkadia",
    runtimeVersion: { policy: "appVersion" },
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  // Every native module the app may need goes in the first build, so that
  // later features ship over the air (Alexis's request of 25/10/2026).
  plugins: [
    ["expo-router", { root: "./src/app" }],
    // Lock Screen and Dynamic Island: a dot per tab driven from the iPhone,
    // updated by Arkadia through APNs (`remote::activity`).
    ["expo-widgets", { enablePushNotifications: true, frequentUpdates: true }],
    // Ad hoc builds talk to APNs production.
    [
      "expo-notifications",
      { mode: "production", enableBackgroundRemoteNotifications: true },
    ],
    [
      "expo-local-authentication",
      { faceIDPermission: "Arkadia demande Face ID avant de s’ouvrir." },
    ],
    [
      "expo-image-picker",
      {
        photosPermission: "Arkadia envoie au PC les photos que tu choisis.",
        cameraPermission: "Arkadia envoie au PC les photos que tu prends.",
        // Same text as the dictation's: the last plugin to run sets it.
        microphonePermission:
          "Arkadia écoute ta voix pour l’écrire dans Claude.",
      },
    ],
    // Dictation on the phone: Claude Code's own voice mode hears the PC's
    // microphone, never the iPhone's.
    [
      "expo-speech-recognition",
      {
        microphonePermission:
          "Arkadia écoute ta voix pour l’écrire dans Claude.",
        speechRecognitionPermission:
          "Arkadia transforme ta voix en texte pour l’écrire dans Claude.",
      },
    ],
    [
      "expo-splash-screen",
      {
        backgroundColor: "#000000",
        image: "./assets/icon.png",
        imageWidth: 120,
      },
    ],
    "expo-document-picker",
    "expo-image",
    "expo-video",
    "expo-secure-store",
    "expo-sqlite",
    "expo-sharing",
    "expo-web-browser",
    "expo-system-ui",
  ],
  extra: {
    eas: {
      projectId: "2bb93e11-a0fa-4145-a7e1-4336a84154d5",
    },
  },
});
