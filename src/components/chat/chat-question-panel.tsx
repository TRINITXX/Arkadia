import { useEffect, useRef, useState } from "react";
import { CircleHelp, Send, X } from "lucide-react";
import type { PermissionResult } from "@/lib/chat/chatProtocol";
import type { PendingRequest } from "@/lib/chat/chatState";

interface Question {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
}

function questionsOf(request: PendingRequest): Question[] {
  const raw = request.input.questions;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (q): q is Question =>
      !!q && typeof q.question === "string" && Array.isArray(q.options),
  );
}

/**
 * Keys this soon after the question shows, or after a key it ignored, were
 * typed for something else (the input it replaced): they never pick nor send
 * an answer. A typist who goes on stays ignored until a pause.
 */
const KEY_GRACE_MS = 600;

/**
 * Claude's AskUserQuestion, inside the input card: options by click or by
 * their number, or your own words. Answers go back as the tool expects them.
 */
export function ChatQuestionPanel({
  request,
  isActive,
  onAnswer,
}: {
  request: PendingRequest;
  /** Only the pane the user is in takes the keyboard. */
  isActive: boolean;
  onAnswer: (result: PermissionResult) => void;
}) {
  const questions = questionsOf(request);
  const [picked, setPicked] = useState<string[][]>(() =>
    questions.map(() => []),
  );
  const [other, setOther] = useState<string[]>(() => questions.map(() => ""));
  const rootRef = useRef<HTMLDivElement>(null);

  const answerOf = (i: number) => other[i].trim() || picked[i].join(", ");
  const complete = questions.every((_, i) => answerOf(i) !== "");

  const submit = () => {
    if (!complete) return;
    onAnswer({
      behavior: "allow",
      updatedInput: {
        ...request.input,
        answers: Object.fromEntries(
          questions.map((q, i) => [q.question, answerOf(i)]),
        ),
      },
    });
  };

  const toggle = (qi: number, label: string) => {
    setOther((o) => o.map((t, i) => (i === qi ? "" : t)));
    setPicked((p) =>
      p.map((sel, i) => {
        if (i !== qi) return sel;
        if (!questions[qi].multiSelect) return [label];
        return sel.includes(label)
          ? sel.filter((l) => l !== label)
          : [...sel, label];
      }),
    );
  };

  // Digits pick in the first unanswered question, Enter sends once all are.
  // Set when the question shows (effect below).
  const quietSince = useRef(0);
  useEffect(() => {
    quietSince.current = Date.now();
    // Takes the keyboard only from nowhere or from its own chat: never from
    // the terminal, notepad or field the user is typing in.
    const focused = document.activeElement;
    const chat = rootRef.current?.closest(".chat-root");
    const free =
      !focused || focused === document.body || !!chat?.contains(focused);
    if (isActive && free) rootRef.current?.focus();
    // Focus on arrival only, not each time the pane becomes active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.requestId]);
  const onKey = (e: React.KeyboardEvent) => {
    if (Date.now() - quietSince.current < KEY_GRACE_MS) {
      quietSince.current = Date.now();
      e.preventDefault();
      return;
    }
    if ((e.target as HTMLElement).tagName === "INPUT") {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
      return;
    }
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1) {
      const qi = Math.max(
        0,
        questions.findIndex((_, i) => answerOf(i) === ""),
      );
      const option = questions[qi]?.options[n - 1];
      if (option) {
        e.preventDefault();
        toggle(qi, option.label);
      }
    }
  };

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={onKey}
      style={{ outline: "none" }}
    >
      {questions.map((q, qi) => (
        <div
          key={q.question}
          style={{ marginBottom: qi < questions.length - 1 ? 12 : 0 }}
        >
          <div className="chat-ask-head">
            <CircleHelp />
            <span>{q.question}</span>
            {qi === 0 && (
              <small>
                {questions.length > 1 ? `${questions.length} questions · ` : ""}
                chiffre pour choisir
              </small>
            )}
          </div>
          {q.multiSelect && (
            <div className="chat-ask-sub">Plusieurs choix possibles</div>
          )}
          {q.options.map((option, oi) => (
            <button
              key={option.label}
              type="button"
              className={`chat-opt${picked[qi].includes(option.label) ? " sel" : ""}`}
              onClick={() => toggle(qi, option.label)}
            >
              <span className="k">{oi + 1}</span>
              <span className="t">
                {option.label}
                {option.description && <span>{option.description}</span>}
              </span>
            </button>
          ))}
          <input
            className="chat-ask-other"
            placeholder="Autre réponse…"
            value={other[qi]}
            onChange={(e) => {
              const text = e.target.value;
              setOther((o) => o.map((t, i) => (i === qi ? text : t)));
              if (text)
                setPicked((p) => p.map((sel, i) => (i === qi ? [] : sel)));
            }}
          />
        </div>
      ))}
      <div className="chat-ask-actions">
        <button
          type="button"
          className="chat-btn primary"
          disabled={!complete}
          onClick={submit}
        >
          <Send /> Répondre
        </button>
        <button
          type="button"
          className="chat-btn ghost"
          onClick={() =>
            onAnswer({
              behavior: "deny",
              message: "The user dismissed the question.",
            })
          }
        >
          <X /> Ignorer
        </button>
      </div>
    </div>
  );
}
