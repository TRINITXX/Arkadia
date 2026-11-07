import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
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
import type { ChatVoice } from "@/components/chat/chat-composer";
import { redirectDictation } from "@/lib/chat/chatDrafts";
import {
  buttonLeadsTo,
  enterLeadsTo,
  lastReplyRound,
  nextQuestionLeft,
  recoReason,
  roundReply,
  type RoundAnswer,
  type RoundQuestion,
} from "@/lib/chat/chatQuestionRound";
import {
  appendSheetText,
  updateSheet,
  useSheetAnswers,
} from "@/lib/chat/chatSheetAnswers";
import type { ChatItem } from "@/lib/chat/chatState";
import { useChatLayer } from "@/lib/chat/useChatLayers";
import { useTypeToInput } from "@/lib/chat/useTypeToInput";

/** A plain Space, as push-to-talk takes it (`ChatComposer`'s). */
const plainSpace = (e: React.KeyboardEvent) =>
  e.key === " " && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;

/**
 * A sheet above the input when Claude's last reply asks a round of questions
 * in its text (`chatQuestionRound`), kept low so the conversation stays in
 * view (the user's pick A of 31/10/2026): one question at a time, its place
 * in a bar of segments on top (green once answered). Per question, its
 * options as a list, Claude's reco inside the one it names with its reason
 * (a reco naming none is a choice of its own), then the mic left of a free
 * field that shows only a caret. Dictation (the mic, Ctrl+Space, or Space
 * held as in the input) lands in the field that started it, its words dim
 * in the field as they come. A pick moves on to a question left.
 * While it shows, Claude's message drops its questions (`useSheetReply`).
 * Enter in the field goes on to a question left, and sends once all are
 * answered; the button at its end steps forward and sends from the last
 * question left, « Q1 : … » per line. Folds (Esc: the questions come back
 * in the message) and closes.
 */
export function ChatQuestionSheet({
  paneKey,
  items,
  voice,
  active,
  working,
  onSend,
  onStop,
  onDictating,
}: {
  /** The pane: answers and « closed » outlive its unmounts. */
  paneKey: string;
  /** Its pane is the active one, on screen: the typing may come here. */
  active: boolean;
  items: ChatItem[];
  voice: ChatVoice;
  /** Claude works again under the sheet (it stays, 02/11/2026). */
  working: boolean;
  onSend: (text: string) => void;
  /** Unfolded, the sheet hides the input and its stop: its own one. */
  onStop: () => void;
  /** A field of the sheet takes the dictation under way (or no longer). */
  onDictating?: (on: boolean) => void;
}) {
  const round = useMemo(() => lastReplyRound(items), [items]);
  const replyId = round?.id ?? "";
  const sheet = useSheetAnswers(paneKey, replyId);
  const folded = !!sheet.folded;
  // The question shown: a new round starts on its first.
  const [view, setView] = useState({ replyId, step: 0 });
  /** The field a dictation of the sheet writes to, while it runs. */
  const [dictating, setDictating] = useState<string | null>(null);

  // The dictation over (text in, failed or cancelled): no field waits for
  // it (the pane clears the target too, `ChatPane`).
  const status = voice.status;
  useEffect(() => {
    if (status === "idle") setDictating(null);
  }, [status]);
  const onDictatingRef = useRef(onDictating);
  useEffect(() => {
    onDictatingRef.current = onDictating;
  });
  useEffect(() => () => onDictatingRef.current?.(false), []);
  // Closed, gone (Claude answers, a request comes) or replaced by another
  // round: no field of it takes a dictation, which goes to the draft.
  const open = round !== null && !sheet.closed;
  // The sheet shows the live words while it holds the dictation; closed,
  // the input shows them, where they land.
  useEffect(() => {
    onDictatingRef.current?.(dictating !== null && open);
  }, [dictating, open]);
  const setFolded = (on: boolean) =>
    updateSheet(paneKey, replyId, (s) => ({ ...s, folded: on }));
  // Esc folds it (its answers stay), never Claude's turn (`chatLayers`).
  useChatLayer(open && !folded, () => setFolded(true));
  const liveRef = useRef({ open, replyId });
  useEffect(() => {
    liveRef.current = { open, replyId };
    return () => {
      // Read by a `start()` that resolves after this: nothing to take it.
      liveRef.current = { open: false, replyId };
      redirectDictation(paneKey, null);
    };
  }, [open, replyId, paneKey]);

  // The question shown: a new round starts on its first.
  const step = round
    ? Math.min(
        view.replyId === replyId ? view.step : 0,
        round.questions.length - 1,
      )
    : 0;
  const shownKey = round?.questions[step]?.key;
  // Unfolded, it takes the typing as the input does: a key typed anywhere in
  // the pane, the focus on no field, lands in the shown question's field
  // (the user's ask of 01/11/2026).
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const typeKey = useCallback(
    (key: string) => {
      if (!shownKey) return;
      updateSheet(paneKey, replyId, (s) => ({
        ...s,
        answers: {
          ...s.answers,
          [shownKey]: {
            ...s.answers[shownKey],
            text: (s.answers[shownKey]?.text ?? "") + key,
          },
        },
      }));
    },
    [paneKey, replyId, shownKey],
  );
  useTypeToInput(areaRef, typeKey, active && open && !folded);

  // Space held talks into the field, as in the input: the tap's space typed
  // a moment ago goes, the release stops it (`ChatComposer`).
  const talkRef = useRef<{ talking: boolean; at: number } | null>(null);
  // The field gone under the held Space (Esc folds, Enter sends, the round
  // goes): no blur nor keyup reaches it any more, the dictation stops here.
  const voiceRef = useRef(voice);
  useEffect(() => {
    voiceRef.current = voice;
  });
  const fieldShown = open && !folded;
  useEffect(() => {
    if (!fieldShown) return;
    return () => {
      if (!talkRef.current?.talking) return;
      talkRef.current = null;
      const { status, stop } = voiceRef.current;
      if (status !== "idle" && status !== "transcribing") void stop();
    };
  }, [fieldShown]);
  // The words dictated into the field shown, in grey after its text as they
  // come, never under it (the user's ask of 03/11/2026). A twin of the field
  // draws them, scrolled to the newest: the field's own text hides meanwhile.
  const liveWords =
    !folded &&
    dictating !== null &&
    dictating === shownKey &&
    voice.status !== "idle"
      ? (voice.interim ?? "")
      : "";
  const wordsRef = useRef<HTMLDivElement>(null);
  const shownText = (shownKey && sheet.answers[shownKey]?.text) || "";
  // The field grows with those words too: its own sizing reads its text only.
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

  if (!round || sheet.closed) return null;
  const { questions } = round;
  const isAnswered = (q: RoundQuestion) => !!roundReply([q], sheet.answers);
  const goTo = (i: number) => setView({ replyId, step: i });
  const q = questions[step];
  const a = sheet.answers[q.key] ?? {};
  const set = (id: string, patch: RoundAnswer) =>
    updateSheet(paneKey, replyId, (s) => ({
      ...s,
      answers: { ...s.answers, [id]: { ...s.answers[id], ...patch } },
    }));
  const answeredFlags = questions.map(isAnswered);
  // Picked: on to the next question left, after this one first.
  const pickAndGo = (patch: RoundAnswer) => {
    set(q.key, patch);
    const next = nextQuestionLeft(answeredFlags, step);
    if (next !== null) goTo(next);
  };
  const reply = roundReply(questions, sheet.answers);
  const answered = answeredFlags.filter(Boolean).length;
  const next = buttonLeadsTo(answeredFlags, step);

  const dictate = (id: string) => {
    if (voice.status === "idle") {
      setDictating(id);
      // The field gets the dictation only once listening began: a start
      // refused (another pane dictating) must leave no target behind.
      // Read again when it resolves: the sheet may have closed meanwhile.
      void Promise.resolve(voice.start()).then((started) => {
        const live = liveRef.current;
        if (started === true && live.open && live.replyId === replyId) {
          redirectDictation(paneKey, (text) =>
            appendSheetText(paneKey, replyId, id, text),
          );
        } else {
          setDictating(null);
        }
      });
    } else if (voice.status !== "transcribing") {
      void voice.stop();
    }
    // The mic clicked: Enter goes on from the field, never clicks it again.
    areaRef.current?.focus();
  };
  const stopTalk = () => {
    const talking = talkRef.current?.talking;
    talkRef.current = null;
    if (talking && voice.status !== "idle" && voice.status !== "transcribing")
      void voice.stop();
  };
  const close = () =>
    updateSheet(paneKey, replyId, (s) => ({ ...s, closed: true }));
  const send = () => {
    if (!reply) return;
    onSend(reply);
    close();
  };
  const recording = dictating !== null && voice.status !== "idle";
  const listening = recording && dictating === q.key;

  // An option it names carries its reason; else the recommendation is a
  // choice of its own.
  const named = q.options.find((o) => o.key === q.recommendedKey);
  const why =
    named && q.recommendation ? recoReason(q.recommendation, named) : "";
  const ownReco = !named && q.recommendation ? q.recommendation : null;

  return (
    <div className={`chat-sheet-q${folded ? " folded" : ""}`}>
      <div className="hd">
        <button
          type="button"
          className="fold"
          title={folded ? "Déplier" : "Replier (Échap)"}
          onClick={() => setFolded(!folded)}
        >
          <CircleHelp />
          <b>Questions de Claude</b>
          {folded && (
            <span>
              · {answered} sur {questions.length} répondue
              {answered > 1 ? "s" : ""}
            </span>
          )}
        </button>
        {!folded && (
          <div className="steps" role="tablist" aria-label="Questions">
            {questions.map((x, i) => (
              <button
                key={x.key}
                type="button"
                role="tab"
                aria-selected={i === step}
                aria-label={`${x.id} : ${x.title}`}
                className={`seg${i === step ? " on" : ""}${isAnswered(x) ? " done" : ""}${dictating === x.key && voice.status !== "idle" ? " rec" : ""}`}
                title={`${x.id} · ${x.title}${isAnswered(x) ? " (répondue)" : ""}`}
                onClick={() => goTo(i)}
              />
            ))}
          </div>
        )}
        {!folded && (
          <span className="pos">
            {step + 1} sur {questions.length}
          </span>
        )}
        {working && !folded && (
          <button
            type="button"
            className="x"
            title="Arrêter Claude"
            onClick={onStop}
          >
            <Square />
          </button>
        )}
        <button
          type="button"
          className="x"
          title={folded ? "Déplier" : "Replier (Échap)"}
          onClick={() => setFolded(!folded)}
        >
          <ChevronDown className="chev" />
        </button>
        <button
          type="button"
          className="x"
          title="Fermer (répondre dans la saisie)"
          onClick={close}
        >
          <X />
        </button>
      </div>
      {!folded && (
        <div className="qs" role="tabpanel">
          <div className="q">
            <div className="qt">{q.title}</div>
            {/* Always whole, never cut: a line hidden is a line missed
                (the user's ask of 07/11/2026). */}
            {q.body && (
              <div className="qb">
                {/* Claude writes it after « Titre : », in lower case. */}
                {q.body.charAt(0).toUpperCase() + q.body.slice(1)}
              </div>
            )}
            {(q.options.length > 0 || ownReco) && (
              <div className="opts" role="radiogroup" aria-label={q.title}>
                {q.options.map((o) => {
                  const rec = q.recommendedKey === o.key;
                  const on = a.option === o.key;
                  return (
                    <button
                      key={o.key}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={`opt${on ? " on" : ""}${rec ? " rec" : ""}`}
                      onClick={() =>
                        on
                          ? set(q.key, { option: undefined })
                          : pickAndGo({ option: o.key, reco: false })
                      }
                    >
                      <span className="radio" />
                      <span className="k">{o.key})</span>
                      <span className="v">{o.label}</span>
                      {rec && (
                        <span className="why">
                          <span className="reco">
                            <Star /> Reco
                          </span>
                          {why}
                        </span>
                      )}
                    </button>
                  );
                })}
                {ownReco && (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!!a.reco}
                    className={`opt rec${a.reco ? " on" : ""}`}
                    onClick={() =>
                      a.reco
                        ? set(q.key, { reco: false })
                        : pickAndGo({ reco: true, option: undefined })
                    }
                  >
                    <span className="radio" />
                    <span className="reco">
                      <Star /> Reco
                    </span>
                    <span className="v">{ownReco}</span>
                  </button>
                )}
              </div>
            )}
            <div className="free">
              <button
                type="button"
                className={`mic${listening ? " rec" : ""}`}
                title={
                  listening ? "Arrêter la dictée" : "Dicter ici (Ctrl+Espace)"
                }
                disabled={
                  voice.status === "transcribing" ||
                  (voice.status !== "idle" && dictating !== q.key)
                }
                onClick={() => dictate(q.key)}
              >
                {listening ? <Square /> : <Mic />}
              </button>
              <div className="box">
                <textarea
                  ref={areaRef}
                  rows={1}
                  value={a.text ?? ""}
                  aria-label={`Ta réponse à ${q.id}`}
                  onChange={(e) => set(q.key, { text: e.target.value })}
                  onKeyUp={(e) => {
                    if (e.key === " " && talkRef.current) stopTalk();
                  }}
                  // Space released elsewhere: the dictation still stops.
                  onBlur={stopTalk}
                  onKeyDown={(e) => {
                    if (e.key === " " && e.ctrlKey) {
                      e.preventDefault();
                      if (!e.repeat) dictate(q.key);
                    } else if (plainSpace(e)) {
                      const area = e.currentTarget;
                      if (!e.repeat) {
                        // A selection the space replaced can't come back:
                        // no talk.
                        talkRef.current =
                          area.selectionStart === area.selectionEnd
                            ? { talking: false, at: area.selectionStart }
                            : null;
                        return;
                      }
                      const talk = talkRef.current;
                      if (!talk) return;
                      e.preventDefault();
                      if (talk.talking || voice.status !== "idle") return;
                      talk.talking = true;
                      // The tap's space, typed a moment ago, goes.
                      const text = a.text ?? "";
                      if (text[talk.at] === " ")
                        set(q.key, {
                          text:
                            text.slice(0, talk.at) + text.slice(talk.at + 1),
                        });
                      dictate(q.key);
                    } else if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      // Held down: one step, not a spin through the round.
                      if (e.repeat) return;
                      // On to the next question left; sent only once all
                      // are answered (the button sends a part).
                      const to = enterLeadsTo(answeredFlags, step);
                      if (to === "send") send();
                      else if (to !== null) goTo(to);
                    }
                  }}
                />
                {liveWords && (
                  <div className="words" ref={wordsRef} aria-hidden="true">
                    {a.text ?? ""}
                    <i>
                      {a.text && !/\s$/.test(a.text) ? " " : ""}
                      {liveWords}
                    </i>
                  </div>
                )}
                {/* No words in it: a caret says it takes some. */}
                {!a.text && !liveWords && (
                  <span className="caret" aria-hidden="true" />
                )}
              </div>
              {/* At the field's end: on to the next question left, and the
                  round sent from the last one (the user's asks of 01/11 and
                  03/11/2026); the bars above step anywhere. */}
              {next === "send" ? (
                <button
                  type="button"
                  className="send"
                  disabled={!reply}
                  title={
                    reply
                      ? `Envoyer ${answered} réponse${answered > 1 ? "s" : ""} sur ${questions.length}`
                      : "Choisis ou écris au moins une réponse"
                  }
                  aria-label="Envoyer les réponses"
                  onClick={send}
                >
                  <Send />
                </button>
              ) : (
                <button
                  type="button"
                  className="send"
                  title="Question suivante (Entrée)"
                  aria-label="Question suivante"
                  onClick={() => {
                    goTo(next);
                    areaRef.current?.focus();
                  }}
                >
                  <ArrowRight />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Folded, or another question shown: the words still come, named. */}
      {recording && (folded || !listening) && voice.interim && (
        <div className="chat-voice-live">
          {questions.find((x) => x.key === dictating)?.id} : {voice.interim}
        </div>
      )}
    </div>
  );
}
