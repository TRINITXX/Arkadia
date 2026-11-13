import { useEffect, useRef, useState } from "react";
import { CircleDollarSign, Pause } from "lucide-react";
import { useLimitNotice } from "@/lib/chat/chatLimitNotice";
import { useCredits } from "@/lib/credits";

/**
 * Above a chat's input while the usage limit holds it with no other account
 * free (the user's pick C of 13/11/2026): what happens next, and the API
 * credits to go on now. The button shows only with a key on disk, and says
 * why it can't when the last Console read found the credits used up.
 */
export function ChatLimitBanner({ chatId }: { chatId: string }) {
  const notice = useLimitNotice(chatId);
  const credits = useCredits();
  const [going, setGoing] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  if (!notice) return null;
  const onCredits = notice.onCredits;
  return (
    <div className="chat-limit-banner" role="status">
      <Pause />
      <span>{notice.text}</span>
      {onCredits && credits.keyPresent && (
        <button
          type="button"
          className="chat-btn primary"
          disabled={going || credits.exhausted}
          title={
            credits.exhausted
              ? "La Console dit les crédits API épuisés"
              : "Reprendre ce chat tout de suite sur les crédits API, en Opus 5.5"
          }
          onClick={() => {
            setGoing(true);
            // Moved: this pane is gone. Failed: the wait goes on, try again.
            void onCredits()
              .catch(() => false)
              .then((moved) => {
                if (!moved && mounted.current) setGoing(false);
              });
          }}
        >
          <CircleDollarSign />
          {credits.exhausted
            ? "Crédits API épuisés"
            : going
              ? "Bascule…"
              : "Continuer sur les crédits"}
        </button>
      )}
    </div>
  );
}
