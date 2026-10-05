import { describe, expect, it } from "vitest";
import { imageTagAt } from "@/lib/imageTag";

describe("imageTagAt", () => {
  const row = "❯ compare [Image #1] with [Image #12]";

  it("finds the tag under the cursor, brackets included", () => {
    const start = row.indexOf("[Image #12]");
    const end = start + "[Image #12]".length;
    expect(imageTagAt(row, start)).toEqual({ n: 12, start, end });
    expect(imageTagAt(row, end - 1)).toEqual({ n: 12, start, end });
    expect(imageTagAt(row, row.indexOf("#1]"))?.n).toBe(1);
  });

  it("ignores text outside a tag and look-alikes", () => {
    expect(imageTagAt(row, row.indexOf("with"))).toBeNull();
    expect(imageTagAt(row, row.indexOf("[Image #12]") + 11)).toBeNull();
    expect(imageTagAt("[Image 1] [image #3] #4", 2)).toBeNull();
  });
});
