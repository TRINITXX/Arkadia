// A file's text as a module, for the desktop's Vite imports (`file.html?raw`,
// `metro.config.js` strips the `?raw`): the chat's visual shell, shared with
// the desktop page. Everything else goes to Expo's own transformer.
const path = require("node:path");

const upstream = require(
  require.resolve("@expo/metro-config/build/babel-transformer", {
    paths: [path.dirname(require.resolve("expo/package.json"))],
  }),
);

module.exports.transform = (args) => {
  if (args.filename.endsWith(".html")) {
    return upstream.transform({
      ...args,
      src: `export default ${JSON.stringify(args.src)};`,
    });
  }
  return upstream.transform(args);
};
