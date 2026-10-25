// The app imports the desktop's shared code (`@/` = ../src): Metro must watch it.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, "../src")];
// Shared files resolve their own imports from the app's node_modules only.
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];

module.exports = config;
