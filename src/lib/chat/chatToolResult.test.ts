import { describe, expect, it } from "vitest";
import { shellMarks, toolDetail } from "@/lib/chat/chatToolResult";

describe("toolDetail", () => {
  it("keeps a command's output and errors apart, without Claude Code's cwd note", () => {
    const detail = toolDetail("Bash", {
      stdout: "sortie",
      stderr: "attention\nShell cwd was reset to C:\\work",
      interrupted: false,
    });
    expect(detail?.shell?.stdout).toBe("sortie");
    expect(detail?.shell?.stderr).toBe("attention");
    expect(shellMarks(detail!.shell!)).toEqual([]);
  });

  it("marks a command past its timeout, sent to the background, or cut", () => {
    // Live run of 31/10/2026: a 2 s timeout, then `run_in_background`.
    const late = toolDetail("Bash", {
      stdout: "",
      stderr: "",
      interrupted: false,
      backgroundTaskId: "bbufpa2a0",
      timedOutAfterMs: 2000,
    });
    expect(shellMarks(late!.shell!)).toEqual([
      "délai dépassé (2 s)",
      "passée en fond",
    ]);
    const launched = toolDetail("Bash", {
      stdout: "",
      stderr: "",
      backgroundTaskId: "bq8ojtaej",
    });
    expect(shellMarks(launched!.shell!)).toEqual(["en fond"]);
    const cut = toolDetail("Bash", {
      stdout: "",
      stderr: "",
      interrupted: true,
      backgroundedByUser: true,
      backgroundTaskId: "x",
    });
    expect(shellMarks(cut!.shell!)).toEqual(["coupée", "passée en fond"]);
  });

  it("knows only the exit code of a failed command, its streams mixed by Claude Code", () => {
    const detail = toolDetail("Bash", "Error: Exit code 3\nsortie\nerreur");
    expect(detail?.shell).toEqual({ exitCode: 3 });
    expect(shellMarks(detail!.shell!)).toEqual(["code 3"]);
  });

  it("keeps a file change's hunks and kind, never its old content", () => {
    const detail = toolDetail("Write", {
      type: "update",
      filePath: "b.txt",
      content: "x\n",
      originalFile: "y\n",
      structuredPatch: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: ["-y", "+x"],
        },
      ],
    });
    expect(detail).toEqual({
      patch: {
        write: "update",
        hunks: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: ["-y", "+x"],
          },
        ],
        noDiff: undefined,
      },
    });
    expect(toolDetail("Read", { file: {} })).toBeUndefined();
  });
});
