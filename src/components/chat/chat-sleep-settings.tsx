import { SLEEP_CHOICES } from "@chat-server/sleep";
import { sleepChoiceLabel, useSleepAfter } from "@/lib/chat/chatSleep";

/**
 * Settings section of the chats' sleep (Lab): after how long without
 * anything done in it a chat stops its Claude Code, and its MCP servers
 * with it. The conversation stays on screen; a key typed wakes it.
 */
export function ChatSleepSettings() {
  const [after, setAfter] = useSleepAfter();
  return (
    <section>
      <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        Veille des chats
      </h4>
      <p className="mb-3 text-[11px] text-zinc-500">
        {
          "Un chat où rien ne se passe arrête son Claude Code (1,5 à 3 Go chacun avec ses serveurs MCP). La conversation reste affichée ; la première touche tapée le réveille sur la même session. Jamais pendant un tour, une tâche de fond, une question ou un message en attente."
        }
      </p>
      <div className="grid grid-cols-4 gap-2">
        {SLEEP_CHOICES.map((ms) => {
          const selected = ms === after;
          return (
            <button
              key={String(ms)}
              type="button"
              onClick={() => setAfter(ms)}
              className={`rounded border px-3 py-2 text-left text-sm transition ${
                selected
                  ? "border-zinc-300 bg-zinc-800 text-zinc-100 ring-1 ring-zinc-300"
                  : "border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:border-zinc-600"
              }`}
            >
              {sleepChoiceLabel(ms)}
            </button>
          );
        })}
      </div>
    </section>
  );
}
