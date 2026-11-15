/**
 * Images pasted into the own words of Claude's AskUserQuestion (the user's
 * ask of 15/11/2026): its answer goes back as text only, so each image is
 * kept in a file, and its tag « [Image #n] » in the answers names that file.
 * Claude reads it as any image on disk.
 */
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

type ImageInput = { mediaType: string; data: string; label?: string };

const DIR = join(process.env.LOCALAPPDATA ?? process.env.TEMP ?? ".", "Arkadia", "answer-images");

/**
 * The folder each session may read without asking (`additionalDirectories`):
 * outside the project, a Read of an answer's image would stop on a
 * permission. Made first, a missing one could fail the start.
 */
export function answerImagesRoots(): string[] {
  try {
    mkdirSync(DIR, { recursive: true });
    return [DIR];
  } catch {
    return [];
  }
}
/** A resumed session may read them again for this long. */
const KEEP_MS = 30 * 86_400_000;

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** Each « [Image #n] » of the answers with its file's path: `[Image #n : C:\…\x.png]`. */
export function answersWithPaths(
  input: Record<string, unknown>,
  paths: ReadonlyMap<number, string>,
): Record<string, unknown> {
  const answers = input.answers;
  if (!answers || typeof answers !== "object" || paths.size === 0) return input;
  const out: Record<string, unknown> = {};
  for (const [question, answer] of Object.entries(answers)) {
    out[question] =
      typeof answer === "string"
        ? answer.replace(/\[Image #(\d+)\]/g, (tag, n: string) => {
            const path = paths.get(Number(n));
            return path ? `[Image #${n} : ${path}]` : tag;
          })
        : answer;
  }
  return { ...input, answers: out };
}

/** Pruned once per server, at its first image: never grows for good. */
let pruned = false;

async function prune(now: number): Promise<void> {
  if (pruned) return;
  pruned = true;
  for (const name of await readdir(DIR)) {
    const file = join(DIR, name);
    const info = await stat(file).catch(() => null);
    if (info && now - info.mtimeMs > KEEP_MS) await unlink(file).catch(() => {});
  }
}

/** The answer with its images in files, named in it; as it was if they can't be written. */
export async function withAnswerImages<R extends { behavior: string }>(
  result: R,
  images: readonly ImageInput[],
): Promise<R> {
  const input = (result as { updatedInput?: Record<string, unknown> }).updatedInput;
  if (result.behavior !== "allow" || !input) return result;
  try {
    await mkdir(DIR, { recursive: true });
    void prune(Date.now()).catch(() => {});
    const paths = new Map<number, string>();
    for (const image of images) {
      const n = Number(/^Image #(\d+)$/.exec(image.label ?? "")?.[1]);
      const extension = EXTENSIONS[image.mediaType];
      if (!n || !extension) continue;
      const bytes = Buffer.from(image.data, "base64");
      // Named by its content: pasted twice, one file.
      const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
      const file = join(DIR, `${hash}.${extension}`);
      await writeFile(file, bytes);
      paths.set(n, file);
    }
    return { ...result, updatedInput: answersWithPaths(input, paths) };
  } catch (e) {
    console.error("answer images:", e instanceof Error ? e.message : e);
    return result;
  }
}
