// A background shell's output, as the console wrote it. Claude Code reads a
// shell's output file as UTF-8 (`getTaskOutput`), but Windows' own programs
// (ping, ipconfig…) write in the console's OEM code page, 850 on a French
// Windows: ping's « Réponse » came with a U+FFFD for its é (seen on
// 31/10/2026). That can't be undone, so the file's bytes are read again
// here: each line as UTF-8 when it is valid, else in the OEM code page.

import { execFile } from "node:child_process";
import { open } from "node:fs/promises";

/** As much as `getTaskOutput` returns: the last 8 KiB. */
const TAIL_BYTES = 8 * 1024;

/** Code page 850's upper half (0x80-0xFF), the OEM page of Western Europe. */
const CP850 =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´\u00ad±‗¾¶§÷¸°¨·¹³²■\u00a0";

/** Bytes in code page 850. */
export function cp850(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes)
    out += b < 0x80 ? String.fromCharCode(b) : CP850[b - 0x80];
  return out;
}

/** A decoder for a code page, or null when neither a table nor Node has it. */
export function codePageDecoder(
  page: number,
): ((bytes: Uint8Array) => string) | null {
  if (page === 850) return cp850;
  for (const label of [`ibm${page}`, `windows-${page}`]) {
    try {
      const decoder = new TextDecoder(label);
      return (bytes) => decoder.decode(bytes);
    } catch {
      // Not one Node knows.
    }
  }
  return null;
}

/** A UTF-8 continuation byte: never the start of a character. */
const isContinuation = (b: number | undefined) =>
  b !== undefined && b >= 0x80 && b <= 0xbf;

/**
 * The console's text: each line UTF-8 when valid (Node, Git Bash), else in
 * the OEM code page (`oem`). A tail read from the middle of the file starts
 * at its first whole line, or, one long line, at its first whole character.
 */
export function consoleText(
  bytes: Uint8Array,
  oem: (bytes: Uint8Array) => string,
  fromMiddle = false,
): string {
  let start = 0;
  if (fromMiddle) {
    const nl = bytes.indexOf(0x0a);
    if (nl >= 0 && nl < bytes.length - 1) start = nl + 1;
    else while (start < 3 && isContinuation(bytes[start])) start += 1;
  }
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  const lines: string[] = [];
  while (start <= bytes.length) {
    const nl = bytes.indexOf(0x0a, start);
    const end = nl < 0 ? bytes.length : nl;
    const line = bytes.subarray(start, end);
    try {
      lines.push(utf8.decode(line));
    } catch {
      lines.push(oem(line));
    }
    start = end + 1;
  }
  return lines.join("\n");
}

/**
 * The output files a tool result names (« Output is being written to:
 * C:\…\tasks\<id>.output », Claude Code's words for every background
 * shell, v2.1.314), by task id.
 */
export function outputFiles(text: string): [taskId: string, path: string][] {
  const found = text.matchAll(
    /Output is being written to:? ([A-Za-z]:[\\/][^\n"]*?[\\/]tasks[\\/]([\w-]+)\.output)/g,
  );
  return [...found].map((m) => [m[2], m[1]]);
}

/**
 * Whether Claude Code's decoding of the output lost characters (U+FFFD).
 * A tail it cut mid-character starts with up to 3 of them: not a reason.
 */
export function needsReread(output: string, truncated: boolean): boolean {
  const body = truncated ? output.replace(/^\uFFFD{1,3}/, "") : output;
  return body.includes("\uFFFD");
}

let oemPage: Promise<number | null> | undefined;

/** Windows' OEM code page (the console's), read once from the registry. */
function oemCodePage(): Promise<number | null> {
  oemPage ??= new Promise((resolve) => {
    execFile(
      "reg",
      [
        "query",
        "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage",
        "/v",
        "OEMCP",
      ],
      { windowsHide: true, timeout: 5_000 },
      (error, stdout) => {
        const page = /OEMCP\s+REG_SZ\s+(\d+)/.exec(stdout)?.[1];
        resolve(error || !page ? null : Number(page));
      },
    );
  });
  return oemPage;
}

/**
 * The end of an output file decoded again; null when its OEM code page has
 * no decoder, the file can't be read (gone with its task), or nothing came
 * of bytes it has: Claude Code's own reading then stays.
 */
export async function readConsoleTail(
  path: string,
): Promise<{ output: string; truncated: boolean } | null> {
  const page = await oemCodePage();
  const oem = page === null ? null : codePageDecoder(page);
  if (!oem) return null;
  try {
    const file = await open(path, "r");
    try {
      const { size } = await file.stat();
      const length = Math.min(size, TAIL_BYTES);
      const bytes = new Uint8Array(length);
      await file.read(bytes, 0, length, size - length);
      const truncated = size > length;
      const output = consoleText(bytes, oem, truncated);
      return length > 0 && !output ? null : { output, truncated };
    } finally {
      await file.close();
    }
  } catch {
    return null;
  }
}
