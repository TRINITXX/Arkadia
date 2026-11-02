import type { ChatEvent, JsonObject } from "@/lib/chat/chatProtocol";
import type { ChatState } from "@/lib/chat/chatState";

/**
 * The chat preview's events for the ideas of 31/10/2026
 * (`chat-preview.html?s=grill|days|older|long`): shapes as the chat server
 * sends them, put together without a model.
 */

const sdk = (message: JsonObject, at?: number): ChatEvent =>
  ({ type: "sdk", chatId: "preview", message, at }) as ChatEvent;

const said = (text: string, at: number): ChatEvent =>
  ({ type: "user_sent", chatId: "preview", text, images: 0, at }) as ChatEvent;

const reply = (id: string, text: string, at: number): ChatEvent =>
  sdk(
    {
      type: "assistant",
      uuid: id,
      message: { id: `m-${id}`, content: [{ type: "text", text }] },
    },
    at,
  );

const done = (at: number): ChatEvent =>
  sdk({ type: "result", subtype: "success", duration_ms: 4_000 }, at);

const LAB = "C:\\Users\\TRINITX\\Desktop\\Claude Desktop\\Arkadia-lab";

/** A grilling round in Claude's last reply: the answer sheet. */
export const GRILL_ROUND = [
  "Trois décisions avant de coder la reprise des chats.",
  "",
  "❓ **Q1** - **Où garder le brouillon** : quand Arkadia recharge, le texte en cours doit survivre. Deux endroits possibles :",
  "",
  "a) Le fichier de réglages de l'app",
  "b) Le stockage de la page",
  "",
  "➡️ b) Le stockage de la page : lu tout de suite au démarrage.",
  "",
  "---",
  "",
  "❓ **Q2** - **Images collées** : on garde aussi les images du brouillon ?",
  "",
  "➡️ Oui, les 4 dernières par volet.",
  "",
  "---",
  "",
  "❓ **Q3** - **Expiration** : un brouillon oublié reste combien de temps ?",
  "",
  "➡️ Une semaine.",
].join("\n");

export function grillEvents(round = GRILL_ROUND): ChatEvent[] {
  const now = Date.now();
  return [
    said("Prépare la reprise des chats après un rechargement.", now - 60_000),
    reply("grill-a1", round, now - 40_000),
    done(now - 39_000),
  ];
}

/** Options that wrap on several lines: the sheet grows, no scroll (02/11/2026). */
export const TALL_ROUND = [
  "❓ **Q1** - **Où garder le brouillon** : il doit survivre à un rechargement d'Arkadia, même au milieu d'une dictée ou d'un collage d'images.",
  "",
  "a) Le fichier de réglages de l'app, écrit à chaque frappe : il survit à un plantage complet, mais chaque lettre tapée coûte une écriture sur le disque et ralentit les gros volets",
  "b) Le stockage de la page, lu tout de suite au démarrage : rien à attendre au rechargement, mais il disparaît si on vide les données du navigateur intégré ou si on change de compte",
  "c) Les deux à la fois, le stockage de la page d'abord puis le fichier de réglages toutes les dix secondes, pour ne rien perdre même après un plantage",
  "d) Nulle part",
  "",
  "➡️ b) Le stockage de la page : lu tout de suite, et un plantage complet reste rare.",
  "",
  "---",
  "",
  "❓ **Q2** - **Expiration** : un brouillon oublié reste combien de temps ?",
  "",
  "➡️ Une semaine.",
].join("\n");

/** Three days of one conversation: the day marks, an edit card, artifact cards. */
export function dayEvents(): ChatEvent[] {
  const day = 86_400_000;
  const now = Date.now();
  const at = (daysAgo: number, h: number, m = 0) => {
    const d = new Date(now - daysAgo * day);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  return [
    said("Fais une page qui résume le plan de la refonte.", at(2, 18, 4)),
    reply(
      "day-a1",
      "La page est publiée : [Plan de la refonte du chat](https://claude.ai/code/artifact/0f3c2b9e-5d1a-4e1b-9a77-2c1d8e6f4a10). Elle reprend les 15 idées, groupées par écran.",
      at(2, 18, 6),
    ),
    done(at(2, 18, 6)),
    said("Corrige la coquille dans le titre du README.", at(1, 9, 12)),
    sdk(
      {
        type: "assistant",
        uuid: "day-t1",
        message: {
          id: "m-day-t1",
          content: [
            {
              type: "tool_use",
              id: "day-edit",
              name: "Edit",
              input: {
                file_path: `${LAB}\\README.md`,
                old_string: "# Arkadia Lba",
                new_string: "# Arkadia Lab",
              },
            },
          ],
        },
      },
      at(1, 9, 13),
    ),
    sdk(
      {
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "day-edit", content: "ok" },
          ],
        },
      },
      at(1, 9, 13),
    ),
    reply("day-a2", "Corrigé : « Lab » au lieu de « Lba ».", at(1, 9, 13)),
    done(at(1, 9, 13)),
    said("Redonne-moi le lien de la page d'hier.", at(0, 8, 30)),
    reply(
      "day-a3",
      "Le voici : https://claude.ai/code/artifact/0f3c2b9e-5d1a-4e1b-9a77-2c1d8e6f4a10",
      at(0, 8, 31),
    ),
    done(at(0, 8, 31)),
  ];
}

/** A resumed session whose past goes further: the button, then its page. */
export function olderStart(): ChatEvent[] {
  return [
    {
      type: "history",
      chatId: "preview",
      truncated: true,
      messages: [
        {
          type: "user",
          uuid: "old-u3",
          timestamp: new Date(Date.now() - 3 * 86_400_000).toISOString(),
          message: { role: "user", content: "Et le compteur de tokens ?" },
        },
        {
          type: "assistant",
          uuid: "old-a3",
          timestamp: new Date(
            Date.now() - 3 * 86_400_000 + 10_000,
          ).toISOString(),
          message: {
            id: "old-m3",
            content: [
              { type: "text", text: "Il suit la réflexion en direct." },
            ],
          },
        },
      ],
    } as ChatEvent,
  ];
}

export function olderPage(): ChatEvent {
  const message = (n: number, role: "user" | "assistant"): JsonObject => ({
    type: role,
    uuid: `old-${role[0]}${n}`,
    timestamp: new Date(
      Date.now() - 3 * 86_400_000 - 7_200_000 + n * 60_000,
    ).toISOString(),
    message:
      role === "user"
        ? { role, content: `Question plus ancienne n° ${n}` }
        : {
            id: `old-m${n}`,
            content: [{ type: "text", text: `Réponse plus ancienne n° ${n}` }],
          },
  });
  return {
    type: "history",
    chatId: "preview",
    truncated: false,
    older: true,
    messages: [1, 2].flatMap((n) => [
      message(n, "user"),
      message(n, "assistant"),
    ]),
  } as ChatEvent;
}

/**
 * A long chat's server log: the recorded tools scenario `times` over, its
 * ids made unique, as a remount used to replay it whole.
 */
export function longLog(base: ChatEvent[], times: number): ChatEvent[] {
  const out: ChatEvent[] = [];
  for (let i = 0; i < times; i++) {
    for (const e of base) {
      const json = JSON.stringify(e).replace(
        /"(uuid|id|tool_use_id|api_message_id|command_uuid)":"([^"]+)"/g,
        (_, k: string, v: string) => `"${k}":"${v}~${i}"`,
      );
      out.push(JSON.parse(json) as ChatEvent);
    }
  }
  return out;
}

/** Two frames: what was rendered is painted. */
const painted = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

/**
 * `window.__remount()` in `?s=long`: a long chat's return to the screen,
 * before (the server's log parsed and replayed into a view mounted anew, the
 * column rendered at each 16 ms batch) and after (the state kept page-side,
 * a view mounted anew on it). `render` renders synchronously (flushSync).
 */
export function installRemountMeasure(
  log: ChatEvent[],
  reduce: (state: ChatState, event: ChatEvent) => ChatState,
  empty: ChatState,
  render: (state: ChatState, anew: boolean) => void,
  batch = 200,
): void {
  const w = window as unknown as {
    __remount?: () => Promise<Record<string, number>>;
  };
  w.__remount = async () => {
    const lines = log.map((e) => JSON.stringify(e));
    // Before: an empty column, then every event again, a render per batch.
    let t = performance.now();
    let state = empty;
    render(state, true);
    for (let i = 0; i < lines.length; i += batch) {
      for (const line of lines.slice(i, i + batch))
        state = reduce(state, JSON.parse(line) as ChatEvent);
      render(state, false);
    }
    await painted();
    const beforeMs = performance.now() - t;
    // The reducer alone, without any render.
    t = performance.now();
    let alone = empty;
    for (const line of lines)
      alone = reduce(alone, JSON.parse(line) as ChatEvent);
    const reduceMs = performance.now() - t;
    await painted();
    // After: the state kept, a view mounted anew on it.
    t = performance.now();
    render(state, true);
    await painted();
    const afterMs = performance.now() - t;
    return {
      events: lines.length,
      items: alone.items.length,
      beforeMs: Math.round(beforeMs),
      reduceMs: Math.round(reduceMs),
      afterMs: Math.round(afterMs),
    };
  };
}
