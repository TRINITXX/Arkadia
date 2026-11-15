import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowRight,
  ChevronDown,
  CircleHelp,
  Mic,
  Send,
  Square,
  Star,
  X,
} from "lucide-react";
import type { LightboxContent } from "@/components/modern/ImageThumb";
import { ChatAttachments } from "@/components/chat/chat-attachments";
import type { DraftImage } from "@/lib/chat/chatDrafts";
import { focusIsFree, focusOf } from "@/lib/chat/chatFocus";
import type { PermissionResult } from "@/lib/chat/chatProtocol";
import { enterLeadsTo, nextQuestionLeft } from "@/lib/chat/chatQuestionRound";
import {
  answerOf,
  answersOf,
  questionsOf,
  recoOf,
  stepBy,
  type Question,
} from "@/lib/chat/chatQuestions";
import type { PendingRequest } from "@/lib/chat/chatState";
import type { ChatImage } from "@/lib/chat/useChatSession";
import {
  lastImageNumber,
  pastedImageFiles,
  readImage,
  sentImages,
  withEveryTag,
  withImageTags,
  withoutImageTag,
} from "@/lib/chat/pastedImages";
import {
  ChatDictationContext,
  useFieldDictation,
  usePushToTalk,
} from "@/lib/chat/useFieldDictation";

/**
 * Keys this soon after the question shows, or after a key it ignored, were
 * typed for something else (the input it replaced): they never pick nor send
 * an answer. A typist who goes on stays ignored until a pause.
 */
const KEY_GRACE_MS = 600;

/**
 * Claude's AskUserQuestion in place of the input, in the look of the
 * questions sheet (`ChatQuestionSheet`, the user's pick of 15/11/2026): a
 * segment per question on top, its options as a list (a), b)…, picked by
 * click or by their number), then the mic left of your own words and the
 * button that goes on to a question left, or sends once all are answered.
 * Answers go back as the tool expects them; × dismisses the question. An
 * image pasted into your own words shows above the field, its « [Image #n] »
 * at the caret: it goes along (the server keeps it in a file Claude reads).
 */
export function ChatQuestionPanel({
  request,
  isActive,
  onAnswer,
  onOpen,
}: {
  request: PendingRequest;
  /** Only the pane the user is in takes the keyboard. */
  isActive: boolean;
  /** `images`: pasted into the own words answered, their tags in them. */
  onAnswer: (result: PermissionResult, images?: ChatImage[]) => void;
  /** A pasted image's thumbnail clicked: the lightbox. */
  onOpen: (content: LightboxContent) => void;
}) {
  const questions = questionsOf(request.input);
  const count = questions.length;
  const [step, setStep] = useState(0);
  const [folded, setFolded] = useState(false);
  const [picked, setPicked] = useState<string[][]>(() =>
    questions.map(() => []),
  );
  const [other, setOther] = useState<string[]>(() => questions.map(() => ""));
  /** Images pasted into each question's own words. */
  const [pics, setPics] = useState<DraftImage[][]>(() =>
    questions.map(() => []),
  );
  // Read when a paste's images are in: numbered after all those of the panel.
  const ownRef = useRef({ other, pics });
  useEffect(() => {
    ownRef.current = { other, pics };
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Your own words dictated too (the mic, Space held, Ctrl+Space), as in
  // the input it replaced (the user's ask of 14/11/2026). Its text goes to
  // the question it was started from, after what that field holds.
  const [dictatedFor, setDictatedFor] = useState(0);
  const field = useFieldDictation(useContext(ChatDictationContext), (text) => {
    setOther((o) =>
      o.map((t, i) =>
        i !== dictatedFor ? t : t.trim() ? `${t.trimEnd()} ${text}` : text,
      ),
    );
    setPicked((p) => p.map((sel, i) => (i === dictatedFor ? [] : sel)));
  });
  // A dictation starts from the field shown: its question takes the text.
  const aimHere = () => {
    if (!field.mine) setDictatedFor(step);
  };
  const setOwn = (text: string) => {
    setOther((o) => o.map((t, i) => (i === step ? text : t)));
    if (text) setPicked((p) => p.map((sel, i) => (i === step ? [] : sel)));
  };
  const talk = usePushToTalk(field, other[step] ?? "", setOwn);
  // The words so far, in grey after the field's text, the newest in view;
  // the field grows with them (its own sizing reads its text only).
  const wordsRef = useRef<HTMLDivElement>(null);
  const liveWords = field.mine && dictatedFor === step ? field.interim : "";
  const shownText = other[step] ?? "";
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.minHeight = "";
    const twin = wordsRef.current;
    if (!twin) return;
    const max = parseFloat(window.getComputedStyle(area).maxHeight) || Infinity;
    const borders = area.offsetHeight - area.clientHeight;
    area.style.minHeight = `${Math.min(twin.scrollHeight + borders, max)}px`;
    twin.scrollTop = twin.scrollHeight;
  }, [liveWords, shownText]);

  // An image's tag the user erased comes back: an image alone answers too.
  const own = other.map((t, i) => withEveryTag(t, pics[i] ?? []));
  const answers = questions.map((_, i) => answerOf(picked[i], own[i]));
  const answered = answers.map(Boolean);
  const complete = answersOf(questions, answers);

  const submit = () => {
    if (!complete) return;
    onAnswer(
      {
        behavior: "allow",
        updatedInput: { ...request.input, answers: complete },
      },
      sentImages(pics.flatMap((list, i) => (own[i].trim() ? list : []))),
    );
  };

  const pasteImages = (
    e: React.ClipboardEvent<HTMLTextAreaElement>,
    qi: number,
  ) => {
    const files = pastedImageFiles(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    const area = e.currentTarget;
    const start = area.selectionStart ?? area.value.length;
    const end = area.selectionEnd ?? start;
    void Promise.all(files.map(readImage)).then((read) => {
      const now = ownRef.current;
      const put = withImageTags(
        now.other[qi] ?? "",
        start,
        end,
        read,
        lastImageNumber(now.other, now.pics.flat()),
      );
      setOther((o) => o.map((t, i) => (i === qi ? put.text : t)));
      setPics((p) => p.map((l, i) => (i === qi ? [...l, ...put.images] : l)));
      setPicked((p) => p.map((sel, i) => (i === qi ? [] : sel)));
      requestAnimationFrame(() => {
        if (area.isConnected && document.activeElement === area)
          area.setSelectionRange(put.caret, put.caret);
      });
    });
  };
  const dropImage = (qi: number, id: string) => {
    const gone = pics[qi]?.find((img) => img.id === id);
    setOther((o) =>
      o.map((t, i) => (i === qi ? withoutImageTag(t, gone?.n) : t)),
    );
    setPics((p) =>
      p.map((l, i) => (i === qi ? l.filter((img) => img.id !== id) : l)),
    );
  };

  // A single choice picked goes on to the next question left, as in the
  // sheet; picked again, it unpicks. A multiple choice stays for more picks.
  const pick = (qi: number, label: string) => {
    const { multiSelect } = questions[qi];
    const was = picked[qi].includes(label);
    setOther((o) => o.map((t, i) => (i === qi ? "" : t)));
    setPics((p) => p.map((l, i) => (i === qi ? [] : l)));
    setPicked((p) =>
      p.map((sel, i) => {
        if (i !== qi) return sel;
        if (!multiSelect) return was ? [] : [label];
        return was ? sel.filter((l) => l !== label) : [...sel, label];
      }),
    );
    if (multiSelect || was) return;
    const next = nextQuestionLeft(answered, qi);
    if (next !== null) setStep(next);
  };

  // Enter goes on to the next question left, and sends once all are
  // answered (`enterLeadsTo`, as in the sheet).
  const enter = () => {
    const to = enterLeadsTo(answered, step);
    if (to === "send") submit();
    else if (to !== null) setStep(to);
  };

  // Digits pick in the question shown, Enter as above, arrows change steps.
  // Set when the question shows (effect below), on the events' clock: a key
  // reads its own time stamp, no clock read in a handler of the render.
  const quietSince = useRef(0);
  useEffect(() => {
    quietSince.current = performance.now();
    // Takes the keyboard only from nowhere or a button of its own chat: never
    // from the terminal, a field, the Ctrl+F box or a menu (`focusIsFree`).
    if (isActive && focusIsFree(focusOf(rootRef.current)))
      rootRef.current?.focus();
    // Focus on arrival only, not each time the pane becomes active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.requestId]);
  // A step change unmounts what had the focus (an option): the panel keeps
  // the keyboard. The field dictated into goes with its step (no blur nor
  // keyup reaches it any more): the dictation stops, its words still land
  // in the question it was started from.
  useEffect(() => {
    if (isActive && focusIsFree(focusOf(rootRef.current)))
      rootRef.current?.focus();
    talk.blur();
    field.stop();
    // On a step change only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.timeStamp - quietSince.current < KEY_GRACE_MS) {
      quietSince.current = e.timeStamp;
      e.preventDefault();
      return;
    }
    // Folded, its questions hidden: no key answers them. The header's
    // buttons (fold, ×) keep their own Enter.
    if (folded || (e.target as HTMLElement).closest(".hd")) return;
    // Shift+Enter: a new line in your own words.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      // Held down: one step, not a spin through the questions.
      if (!e.repeat) enter();
      return;
    }
    // The own-words field keeps its keys, arrows included.
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (count > 1 && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      setStep(stepBy(step, e.key === "ArrowRight" ? 1 : -1, count));
      return;
    }
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1) {
      const option = questions[step]?.options[n - 1];
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
  const fold = (on: boolean) => {
    // The field goes: its dictation stops, as on a step change.
    if (on) {
      talk.blur();
      field.stop();
    }
    setFolded(on);
  };

  // No question to read (an input the tool should never send): the header
  // alone, its × still dismisses it, else Claude would wait for good.
  const q: Question | undefined = questions[step];
  const left = nextQuestionLeft(answered, step);
  const done = answered.filter(Boolean).length;
  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={onKey}
      className={`chat-sheet-q ask${folded ? " folded" : ""}`}
    >
      <div className="hd">
        <button
          type="button"
          className="fold"
          title={folded ? "Déplier" : "Replier"}
          onClick={() => fold(!folded)}
        >
          <CircleHelp />
          <b>Questions de Claude</b>
          {folded && (
            <span>
              · {done} sur {count} répondue{done > 1 ? "s" : ""}
            </span>
          )}
        </button>
        {!folded && (
          <div className="steps" role="tablist" aria-label="Questions">
            {questions.map((x, i) => (
              <button
                key={x.question}
                type="button"
                role="tab"
                aria-selected={i === step}
                aria-label={x.question}
                className={`seg${i === step ? " on" : ""}${answered[i] ? " done" : ""}${field.mine && dictatedFor === i ? " rec" : ""}`}
                title={`${x.header ? `${x.header} · ` : ""}${x.question}${answered[i] ? " (répondue)" : ""}`}
                onClick={() => setStep(i)}
              />
            ))}
          </div>
        )}
        {!folded && q && (
          <span className="pos">
            {step + 1} sur {count}
          </span>
        )}
        <button
          type="button"
          className="x"
          title={folded ? "Déplier" : "Replier"}
          onClick={() => fold(!folded)}
        >
          <ChevronDown className="chev" />
        </button>
        <button
          type="button"
          className="x"
          title="Ignorer la question"
          onClick={dismiss}
        >
          <X />
        </button>
      </div>
      {!folded && q && (
        <div className="qs" role="tabpanel">
          {/* No key per question: the field stays the same one, and keeps
              the focus from a question to the next (Enter, the arrow),
              as in the sheet; else a digit typed next picks an option. */}
          <div className="q">
            <div className="qt">{q.question}</div>
            {q.multiSelect && (
              <div className="qb">Plusieurs choix possibles</div>
            )}
            <div
              className="opts"
              role={q.multiSelect ? "group" : "radiogroup"}
              aria-label={q.question}
            >
              {q.options.map((option, oi) => {
                const on = picked[step].includes(option.label);
                const { text, reco } = recoOf(option.label);
                return (
                  <button
                    key={option.label}
                    type="button"
                    role={q.multiSelect ? "checkbox" : "radio"}
                    aria-checked={on}
                    className={`opt${on ? " on" : ""}${reco ? " rec" : ""}${option.description ? " two" : ""}`}
                    title={oi < 9 ? `Touche ${oi + 1}` : undefined}
                    onClick={() => pick(step, option.label)}
                  >
                    <span className={`radio${q.multiSelect ? " sq" : ""}`} />
                    <span className="k">{String.fromCharCode(97 + oi)})</span>
                    <span className="t">
                      <span className="row">
                        <span className="v">{text}</span>
                        {reco && (
                          <span className="reco">
                            <Star /> Reco
                          </span>
                        )}
                      </span>
                      {option.description && (
                        <span className="d">{option.description}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            {/* Above the field, as above the input. */}
            {pics[step].length > 0 && (
              <div className={`chat-field-pics${field.can ? "" : " flush"}`}>
                <ChatAttachments
                  sources={pics[step].map((img) => ({
                    kind: "pasted" as const,
                    key: img.id,
                    url: img.url,
                    name: `Image collée ${img.n ?? ""}`.trim(),
                  }))}
                  onOpen={onOpen}
                  onRemove={(id) => dropImage(step, id)}
                />
              </div>
            )}
            <div className="free">
              {field.can && (
                <button
                  type="button"
                  className={`mic${field.mine ? " rec" : ""}`}
                  title={
                    field.mine
                      ? "Arrêter la dictée"
                      : "Dicter ici (Ctrl+Espace)"
                  }
                  disabled={field.busy || field.status === "transcribing"}
                  onClick={() => {
                    aimHere();
                    field.toggle();
                  }}
                >
                  {field.mine ? <Square /> : <Mic />}
                </button>
              )}
              <div className="box">
                <textarea
                  ref={areaRef}
                  rows={1}
                  value={shownText}
                  aria-label="Ta réponse"
                  onChange={(e) => setOwn(e.target.value)}
                  onKeyDown={(e) => {
                    aimHere();
                    talk.keyDown(e);
                  }}
                  onKeyUp={talk.keyUp}
                  // Space released elsewhere: the dictation still stops.
                  onBlur={talk.blur}
                  onPaste={(e) => pasteImages(e, step)}
                />
                {liveWords && (
                  <div className="words" ref={wordsRef} aria-hidden="true">
                    {shownText}
                    <i>
                      {shownText && !/\s$/.test(shownText) ? " " : ""}
                      {liveWords}
                    </i>
                  </div>
                )}
                {/* No words in it: a caret says it takes some. */}
                {!shownText && !liveWords && (
                  <span className="caret" aria-hidden="true" />
                )}
              </div>
              {/* On to a question left; once all are answered, the answers
                  go (the tool needs one per question). */}
              {!complete && left !== null ? (
                <button
                  type="button"
                  className="send"
                  title="Question suivante (Entrée)"
                  aria-label="Question suivante"
                  onClick={() => {
                    setStep(left);
                    areaRef.current?.focus();
                  }}
                >
                  <ArrowRight />
                </button>
              ) : (
                <button
                  type="button"
                  className="send"
                  disabled={!complete}
                  title={
                    complete
                      ? "Envoyer (Entrée)"
                      : "Choisis ou écris une réponse"
                  }
                  aria-label="Envoyer les réponses"
                  onClick={submit}
                >
                  <Send />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
