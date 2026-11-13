import { CircleDollarSign } from "lucide-react";
import {
  CREDITS_LABEL,
  creditsLines,
  dollars,
  teamLeft,
  useCredits,
} from "@/lib/credits";

/**
 * A chat on the API credits has no subscription quotas: this pill takes the
 * place of its 5-hour and weekly rings (the user's pick A of 13/11/2026),
 * with the Team credit left, the one a key pays with.
 */
export function ChatCreditsPill() {
  const credits = useCredits();
  const team = teamLeft(credits);
  const lines = creditsLines(credits);
  return (
    <span
      className="chat-credits-pill"
      title={["Ce chat tourne sur les crédits API, en Opus 5.5", ...lines].join(
        "\n",
      )}
    >
      <CircleDollarSign size={12} />
      {CREDITS_LABEL}
      {team !== null && (
        <>
          {" ·"}
          <b>{dollars(team)}</b>
        </>
      )}
    </span>
  );
}
