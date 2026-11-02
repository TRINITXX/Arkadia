// The app imports the desktop's shared code (`@/` = ../src, `@chat-server/` =
// ../chat-server, both by the tsconfig's paths): Metro must watch it.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [
  path.resolve(__dirname, "../src"),
  path.resolve(__dirname, "../chat-server"),
];
// Shared files resolve their own imports from the app's node_modules only.
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];

// The desktop's Vite reads a file's text with `?raw` (the chat's visual
// shell): the query goes, the file resolves, `raw-transformer.js` makes it a
// module of its text. Out of the assets too, which Metro tries first: left
// there, the shell came as an asset's id, `chatVisual` threw at load and the
// app closed at a chat's first open (02/11/2026).
config.resolver.sourceExts = [...config.resolver.sourceExts, "html"];
config.resolver.assetExts = config.resolver.assetExts.filter(
  (ext) => ext !== "html",
);
const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, name, platform) => {
  const clean = name.endsWith("?raw") ? name.slice(0, -"?raw".length) : name;
  return upstreamResolve
    ? upstreamResolve(context, clean, platform)
    : context.resolveRequest(context, clean, platform);
};
config.transformer.babelTransformerPath = require.resolve("./raw-transformer.js");

module.exports = config;
