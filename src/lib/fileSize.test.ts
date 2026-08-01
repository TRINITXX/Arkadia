import { describe, it, expect } from "vitest";
import { formatSize } from "./fileSize";

describe("formatSize", () => {
  it("keeps small files in bytes", () => {
    expect(formatSize(0)).toBe("0 o");
    expect(formatSize(512)).toBe("512 o");
    expect(formatSize(1023)).toBe("1023 o");
  });

  it("switches unit at 1024, not 1000", () => {
    expect(formatSize(1024)).toBe("1,0 Ko");
    expect(formatSize(1048576)).toBe("1,0 Mo");
  });

  it("shows a decimal below ten of a unit and none above", () => {
    expect(formatSize(5_068_847_104)).toBe("4,7 Go"); // the Kubuntu ISO
    expect(formatSize(266_526_896)).toBe("254 Mo"); // the Termius installer
    expect(formatSize(40_747)).toBe("40 Ko"); // the CSV
    expect(formatSize(7_597_376)).toBe("7,2 Mo"); // the Hermes installer
  });

  it("uses a comma, as French does", () => {
    expect(formatSize(1536)).toBe("1,5 Ko");
    expect(formatSize(1536)).not.toContain(".");
  });

  it("yields nothing for a size that makes no sense", () => {
    expect(formatSize(-1)).toBe("");
    expect(formatSize(NaN)).toBe("");
  });
});
