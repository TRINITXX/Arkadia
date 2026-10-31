import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Send,
  Square,
  SquareCheck,
  X,
} from "lucide-react";
import { focusIsFree, focusOf } from "@/lib/chat/chatFocus";
import type { PermissionResult } from "@/lib/chat/chatProtocol";
import {
  answerOf,
  answersOf,
  questionsOf,
  stepAfterPick,
  stepBy,
} from "@/lib/chat/chatQuestions";
import type { PendingRequest } from "@/lib/chat/chatState";

/**
 * Keys this soon after the question shows, or after a key it ignored, were
 * typed for something else (the input it replaced): they never pick nor send
 * an answer. A typist who goes on stays ignored until a pause.
 */
const KEY_GRACE_MS = 600;

/**
 * Claude's AskUserQuestion, inside the input card: options by click or by
 * their number, or your own words. Several questions come one at a time, as
 * in the terminal: a tab each, ticked once answered, then « Envoyer », which
 * sends them all. Answers go back as the tool expects them.
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
  const questions = questionsOf(request.input);
  /** Also the « Envoyer » step's number. */
  const count = questions.length;
  const tabbed = count > 1;
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<string[][]>(() =>
    questions.map(() => []),
  );
  const [other, setOther] = useState<string[]>(() => questions.map(() => ""));
  const rootRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  const answers = questions.map((_, i) => answerOf(picked[i], other[i]));
  const complete = answersOf(questions, answers);

  const submit = () => {
    if (!complete) return;
    onAnswer({
      behavior: "allow",
      updatedInput: { ...request.input, answers: complete },
    });
  };

  const pick = (qi: number, label: string) => {
    const { multiSelect } = questions[qi];
    setOther((o) => o.map((t, i) => (i === qi ? "" : t)));
    setPicked((p) =>
      p.map((sel, i) => {
        if (i !== qi) return sel;
        if (!multiSelect) return [label];
        return sel.includes(label)
          ? sel.filter((l) => l !== label)
          : [...sel, label];
      }),
    );
    if (tabbed) setStep(stepAfterPick(qi, count, multiSelect));
  };

  // Enter sends a lone question; with tabs it goes on, and sends from the
  // last step.
  const enter = () => {
    if (!tabbed || step === count) submit();
    else if (answers[step]) setStep(stepBy(step, 1, count));
  };

  // Digits pick in the question shown, Enter as above, arrows change steps.
  // Set when the question shows (effect below).
  const quietSince = useRef(0);
  useEffect(() => {
    quietSince.current = Date.now();
    // Takes the keyboard only from nowhere or a button of its own chat: never
    // from the terminal, a field, the Ctrl+F box or a menu (`focusIsFree`).
    if (isActive && focusIsFree(focusOf(rootRef.current)))
      rootRef.current?.focus();
    // Focus on arrival only, not each time the pane becomes active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.requestId]);
  // A step change unmounts what had the focus (an option, the own-words
  // field): the panel keeps the keyboard, and its tab comes into view.
  useEffect(() => {
    if (!tabbed) return;
    if (isActive && focusIsFree(focusOf(rootRef.current))) {
      rootRef.current?.focus();
    }
    tabsRef.current
      ?.querySelector(".on")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    // On a step change only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const onKey = (e: React.KeyboardEvent) => {
    if (Date.now() - quietSince.current < KEY_GRACE_MS) {
      quietSince.current = Date.now();
      e.preventDefault();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      enter();
      return;
    }
    // The own-words field keeps its keys, arrows included.
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (tabbed && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      setStep(stepBy(step, e.key === "ArrowRight" ? 1 : -1, count));
      return;
    }
    const n = Number(e.key);
    if (step < count && Number.isInteger(n) && n >= 1) {
      const option = questions[step].options[n - 1];
      if (option) {
        e.preventDefault();
        pick(step, option.label);
      }
    }
  };

  const dismiss = () =>
    onAnswer({
      behavior: "deny",
      message: "The user dismissed the question.",
    });

  const q = step < count ? questions[step] : null;
  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={onKey}
      style={{ outline: "none" }}
    >
      {tabbed && (
        <div
          ref={tabsRef}
          className="chat-ask-tabs"
          role="tablist"
          // A row too narrow for its tabs scrolls under the wheel.
          onWheel={(e) => {
            if (!e.deltaX) e.currentTarget.scrollLeft += e.deltaY;
          }}
        >
          <button
            type="button"
            className="nav"
            title="Question précédente (←)"
            disabled={step === 0}
            onClick={() => setStep(stepBy(step, -1, count))}
          >
            <ChevronLeft />
          </button>
          {questions.map((question, i) => (
            <button
              key={question.question}
              type="button"
              role="tab"
              aria-selected={step === i}
              className={`${step === i ? "on" : ""}${answers[i] ? " done" : ""}`}
              title={question.question}
              onClick={() => setStep(i)}
            >
              {answers[i] ? <SquareCheck /> : <Square />}
              <span>{question.header || `Question ${i + 1}`}</span>
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={step === count}
            className={`${step === count ? "on" : ""}${complete ? " done" : ""}`}
            onClick={() => setStep(count)}
          >
            <Check />
            <span>Envoyer</span>
          </button>
          <button
            type="button"
            className="nav"
            title="Question suivante (→)"
            disabled={step === count}
            onClick={() => setStep(stepBy(step, 1, count))}
          >
            <ChevronRight />
          </button>
        </div>
      )}
      {q ? (
        <div key={q.question}>
          <div className="chat-ask-head">
            <CircleHelp />
            <span>{q.question}</span>
            <small>
              {tabbed ? "chiffre pour choisir · ←/→" : "chiffre pour choisir"}
            </small>
          </div>
          {q.multiSelect && (
            <div className="chat-ask-sub">Plusieurs choix possibles</div>
          )}
          {q.options.map((option, oi) => (
            <button
              key={option.label}
              type="button"
              className={`chat-opt${picked[step].includes(option.label) ? " sel" : ""}`}
              onClick={() => pick(step, option.label)}
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
            value={other[step]}
            onChange={(e) => {
              const text = e.target.value;
              setOther((o) => o.map((t, i) => (i === step ? text : t)));
              if (text)
                setPicked((p) => p.map((sel, i) => (i === step ? [] : sel)));
            }}
          />
        </div>
      ) : (
        <div>
          <div className="chat-ask-head">
            <Check />
            <span>Vérifie tes réponses</span>
            <small>Entrée pour envoyer</small>
          </div>
          <div className="chat-ask-review">
            {questions.map((question, i) => (
              <button
                key={question.question}
                type="button"
                className={answers[i] ? undefined : "missing"}
                onClick={() => setStep(i)}
              >
                <span className="q">{question.question}</span>
                <span className="a">→ {answers[i] || "sans réponse"}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="chat-ask-actions">
        {tabbed && q ? (
          <button
            type="button"
            className="chat-btn"
            disabled={!answers[step]}
            onClick={() => setStep(stepBy(step, 1, count))}
          >
            Suivant <ArrowRight />
          </button>
        ) : (
          <button
            type="button"
            className="chat-btn primary"
            disabled={!complete}
            onClick={submit}
          >
            <Send /> {tabbed ? "Envoyer" : "Répondre"}
          </button>
        )}
        <button type="button" className="chat-btn ghost" onClick={dismiss}>
          <X /> Ignorer
        </button>
      </div>
    </div>
  );
}
