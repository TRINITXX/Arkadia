import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

interface MetroConfig {
  resolver: { sourceExts: string[]; assetExts: string[] };
}

describe("the iPhone app's Metro config", () => {
  // A `?raw` file (the visuals' shell) resolved as an asset gave
  // `chatVisual` an asset's id for its text: it threw at load, and the app
  // closed at a chat's first open (02/11/2026).
  it("reads .html as source text, never as an asset", () => {
    const config = require("../../../iphone/metro.config.js") as MetroConfig;
    expect(config.resolver.sourceExts).toContain("html");
    expect(config.resolver.assetExts).not.toContain("html");
  });
});
