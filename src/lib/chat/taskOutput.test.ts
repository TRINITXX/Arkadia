import { describe, expect, it } from "vitest";
import {
  codePageDecoder,
  consoleText,
  cp850,
  needsReread,
  outputFiles,
} from "../../../chat-server/taskOutput.ts";

/** `ping` on a French Windows, as its output file holds it (31/10/2026). */
const PING = Uint8Array.from([
  ...Buffer.from("R"),
  0x82,
  ...Buffer.from("ponse de 127.0.0.1"),
  0xff,
  ...Buffer.from(": octets=32\r\n"),
]);

describe("a background shell's output (chat-server/taskOutput.ts)", () => {
  it("reads Windows' own programs in the console's code page", () => {
    expect(consoleText(PING, cp850)).toBe(
      "Réponse de 127.0.0.1\u00a0: octets=32\r\n",
    );
    expect(codePageDecoder(850)?.(Uint8Array.from([0x88]))).toBe("ê");
  });

  it("keeps UTF-8 lines as they are, line by line", () => {
    const mixed = Uint8Array.from([...Buffer.from("déjà vu\n"), ...PING]);
    expect(consoleText(mixed, cp850)).toBe(
      "déjà vu\nRéponse de 127.0.0.1\u00a0: octets=32\r\n",
    );
  });

  it("starts a tail read mid-file at its first whole line", () => {
    const tail = Uint8Array.from([0xa9, ...Buffer.from("x\nfin")]);
    expect(consoleText(tail, cp850, true)).toBe("fin");
  });

  it("reads the tail of one long UTF-8 line from its first whole character", () => {
    // 10 000 bytes of « é », no line break: the last 8 KiB, cut mid-character.
    const line = Buffer.from("é".repeat(5_000));
    const tail = line.subarray(line.length - 8_191);
    expect(tail[0]).toBe(0xa9);
    expect(consoleText(tail, cp850, true)).toBe("é".repeat(4_095));
    // Claude Code's own tail starts with the U+FFFD of the cut: no re-read.
    expect(needsReread(`\uFFFD${"é".repeat(4_095)}`, true)).toBe(false);
    expect(needsReread("R\uFFFDponse de 127.0.0.1", false)).toBe(true);
    expect(needsReread(`\uFFFDx\nR\uFFFDponse`, true)).toBe(true);
  });

  it("finds the output file a Bash result names, spaces included", () => {
    expect(
      outputFiles(
        "Shell cwd was reset to C:\\Users\\A B\\Temp\nCommand running in background with ID: bl352twqp. Output is being written to: C:\\Users\\A B\\Temp\\claude\\x\\tasks\\bl352twqp.output. You will be notified",
      ),
    ).toEqual([
      ["bl352twqp", "C:\\Users\\A B\\Temp\\claude\\x\\tasks\\bl352twqp.output"],
    ]);
    // A path the command printed itself names no shell of Claude Code's.
    expect(outputFiles("cat C:\\tmp\\tasks\\abc.output")).toEqual([]);
  });
});
