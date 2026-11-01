import { useEffect, useMemo, useRef, useState } from "react";
import {
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
  lastReplyRound,
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

/**
 * A sheet above the input when Claude's last reply asks a round of questions
 * in its text (`chatQuestionRound`), kept low so the conversation stays in
 * view (the user's pick A of 31/10/2026): one question at a time, its place
 * in a bar of segments on top (green once answered). Per question, its
 * options as a list, Claude's reco inside the one it names with its reason
 * (a reco naming none is a choice of its own), then the mic left of a free
 * field that shows only a caret (dictation lands in the field that started
 * it, its words dim as they come). A pick moves on to a question left.
 * While it shows, Claude's message drops its questions (`useSheetReply`).
 * « Précédente », « Suivante », and one « Envoyer n/N » that answers them
 * all, « Q1 : … » per line. Folds (Esc: the questions come back in the
 * message) and closes.
 */
export function ChatQuestionSheet({
  paneKey,
  items,
  voice,
  onSend,
  onDictating,
}: {
  /** The pane: answers and « closed » outlive its unmounts. */
  paneKey: string;
  items: ChatItem[];
  voice: ChatVoice;
  onSend: (text: string) => void;
  /** A field of the sheet takes the dictation under way (or no longer). */
  onDictating?: (on: boolean) => void;
}) {
  const round = useMemo(() => lastReplyRound(items), [items]);
  const replyId = round?.id ?? "";
  const sheet = useSheetAnswers(paneKey, replyId);
  const folded = !!sheet.folded;
  // The question shown, and its text unclamped: a new round starts on its first.
  const [view, setView] = useState({ replyId, step: 0, more: false });
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

  if (!round || sheet.closed) return null;
  const { questions } = round;
  const isAnswered = (q: RoundQuestion) => !!roundReply([q], sheet.answers);
  const step = Math.min(
    view.replyId === replyId ? view.step : 0,
    questions.length - 1,
  );
  const more = view.replyId === replyId && view.more;
  const goTo = (i: number) => setView({ replyId, step: i, more: false });
  const q = questions[step];
  const a = sheet.answers[q.key] ?? {};
  const set = (id: string, patch: RoundAnswer) =>
    updateSheet(paneKey, replyId, (s) => ({
      ...s,
      answers: { ...s.answers, [id]: { ...s.answers[id], ...patch } },
    }));
  // Picked: on to the next question left, after this one first.
  const pickAndGo = (patch: RoundAnswer) => {
    set(q.key, patch);
    const left = (i: number) => i !== step && !isAnswered(questions[i]);
    const order = questions.map((_, i) => i);
    const next =
      order.find((i) => i > step && left(i)) ?? order.find((i) => left(i));
    if (next !== undefined) goTo(next);
  };
  const reply = roundReply(questions, sheet.answers);
  const answered = questions.filter(isAnswered).length;

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
            {q.body && (
              <div
                className={`qb${more ? " more" : ""}`}
                title={more ? "Réduire" : "Tout lire"}
                onClick={() => {
                  // A selection drag ends in a click: it selected.
                  if (window.getSelection()?.toString()) return;
                  setView({ replyId, step, more: !more });
                }}
              >
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
                  rows={1}
                  value={a.text ?? ""}
                  aria-label={`Ta réponse à ${q.id}`}
                  onChange={(e) => set(q.key, { text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === " " && e.ctrlKey) {
                      e.preventDefault();
                      if (!e.repeat) dictate(q.key);
                    } else if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      send();
                    }
                  }}
                />
                {/* No words in it: a caret says it takes some. */}
                {!a.text && <span className="caret" aria-hidden="true" />}
              </div>
              {/* One send for the round, at the field's end; the bars above
                  step between questions (the user's ask of 01/11/2026). */}
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
            </div>
            {listening && voice.interim && (
              <div className="chat-voice-live">{voice.interim}</div>
            )}
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
