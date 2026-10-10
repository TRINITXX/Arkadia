import { describe, it, expect, vi } from "vitest";

const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0];

// Tauri's postMessage fallback hands raw bytes over as a number array.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async () => JPEG_HEAD,
}));

import { fetchImageUrl } from "@/lib/imageUrlCache";

describe("fetchImageUrl", () => {
  it("keeps the image bytes when IPC hands them over as a number array", async () => {
    const blobs: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
      blobs.push(b as Blob);
      return "blob:x";
    });
    expect(await fetchImageUrl("C:\\shots\\kit.jpg")).toBe("blob:x");
    const bytes = new Uint8Array(await blobs[0].arrayBuffer());
    expect([...bytes]).toEqual(JPEG_HEAD);
    expect(blobs[0].type).toBe("image/jpeg");
  });
});
