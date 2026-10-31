import type { ChatEvent, JsonObject } from "@/lib/chat/chatProtocol";
import type { ChatDraft } from "@/lib/chat/chatDrafts";
import { withAttachedPaths } from "@/lib/chat/chatAttachments";

/**
 * The chat preview's attachments (`chat-preview.html?s=attach`): files sent
 * as cards, Claude reading the capture, and an input holding a pasted image,
 * a capture, a document and a folder. The capture's name is Windows' own,
 * apostrophe and accent included (copied into the worktree's `.screenshots`,
 * which the preview's server may read).
 */

const LAB = "C:\\Users\\TRINITX\\Desktop\\Claude Desktop\\Arkadia-lab";
const SHOT = `${LAB}\\.screenshots\\Capture d'écran 2026-10-31 130956.png`;
const DOC = `${LAB}\\REVIEW.md`;
/** Copied into `.screenshots` too: any capture of the chat. */
const MOCKUP = `${LAB}\\.screenshots\\maquette-saisie.png`;

const sdk = (message: JsonObject): ChatEvent => ({
  type: "sdk",
  chatId: "preview",
  message,
});

export function attachEvents(): ChatEvent[] {
  return [
    {
      type: "user_sent",
      chatId: "preview",
      text: withAttachedPaths(
        "Fais les pièces jointes comme sur cette capture.",
        [SHOT, DOC],
      ),
      images: 0,
    },
    sdk({
      type: "assistant",
      uuid: "att-t1",
      message: {
        id: "att-m0",
        content: [
          {
            type: "tool_use",
            id: "att-r1",
            name: "Read",
            input: { file_path: SHOT },
          },
        ],
      },
    }),
    sdk({
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "att-r1", content: "image" },
        ],
      },
    }),
    sdk({
      type: "assistant",
      uuid: "att-a1",
      message: {
        id: "att-m1",
        content: [
          {
            type: "text",
            text: "Vu : une carte par fichier au-dessus de la saisie, l'image en vignette, les autres fichiers avec leur icône et leur nom.",
          },
        ],
      },
    }),
    sdk({ type: "result", subtype: "success", duration_ms: 21_000 }),
  ];
}

/** The input of `?s=attach`: a pasted image, then three files. */
export function attachDraft(pastedUrl: string): ChatDraft {
  const [, mediaType = "image/png", data = ""] =
    /^data:([^;]+);base64,(.*)$/.exec(pastedUrl) ?? [];
  return {
    text: "Et celles-ci ?",
    images: [{ id: "att-p1", url: pastedUrl, mediaType, data }],
    files: [
      { id: "att-f1", path: MOCKUP },
      { id: "att-f2", path: DOC },
      { id: "att-f3", path: `${LAB}\\src\\components\\chat` },
    ],
  };
}
