// The app's own lint (`npx expo lint`): the repo root's ignores iphone/.
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", "ios/*", "android/*"],
  },
  {
    // These rules guard code the React Compiler rewrites; the app does not
    // turn it on (no `experiments.reactCompiler`). Turn them back on with it.
    rules: {
      "react-hooks/refs": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);
