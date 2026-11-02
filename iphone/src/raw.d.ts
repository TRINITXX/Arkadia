// A file's text (`metro.config.js`, `raw-transformer.js`), as the desktop's
// Vite reads it: the chat's visual shell.
declare module "*.html?raw" {
  const text: string;
  export default text;
}
