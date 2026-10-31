import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  CircleHelp,
  Mic,
  Send,
  Square,
  X,
} from "lucide-react";
import type { ChatVoice } from "@/components/chat/chat-composer";
import { redirectDictation } from "@/lib/chat/chatDrafts";
import {
  lastReplyRound,
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
 * view: one question at a time behind its tab (ticked once answered), as the
 * question panel does. Per question, « OK pour ta reco », its options, a free
 * field (dictation lands in the one that started it, its words dim as they
 * come). A pick moves on to a question left. While it shows, Claude's
 * message drops its questions (`useSheetReply`). One « Envoyer » answers them
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
  const a = sheet.answers[q.id] ?? {};
  const set = (id: string, patch: RoundAnswer) =>
    updateSheet(paneKey, replyId, (s) => ({
      ...s,
      answers: { ...s.answers, [id]: { ...s.answers[id], ...patch } },
    }));
  // Picked: on to the next question left, after this one first.
  const pickAndGo = (patch: RoundAnswer) => {
    set(q.id, patch);
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
  const send = () => {
    if (!reply) return;
    onSend(reply);
    updateSheet(paneKey, replyId, (s) => ({ ...s, closed: true }));
  };
  const recording = dictating !== null && voice.status !== "idle";
  const listening = recording && dictating === q.id;

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
          {folded && (
            <>
              <b>
                {questions.length} question{questions.length > 1 ? "s" : ""} de
                Claude
              </b>
              <span>
                {answered > 0
                  ? `· ${answered} répondue${answered > 1 ? "s" : ""}`
                  : ""}
              </span>
            </>
          )}
          <ChevronDown className="chev" />
        </button>
        {!folded && (
          <div className="tabs" role="tablist">
            {questions.map((x, i) => (
              <button
                key={x.id}
                type="button"
                role="tab"
                aria-selected={i === step}
                className={`tab${i === step ? " on" : ""}${isAnswered(x) ? " done" : ""}${dictating === x.id && voice.status !== "idle" ? " rec" : ""}`}
                title={x.title}
                onClick={() => goTo(i)}
              >
                {isAnswered(x) && <Check />}
                {x.id}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className="chat-btn primary send"
          disabled={!reply}
          title={
            reply
              ? `Envoyer ${answered} réponse${answered > 1 ? "s" : ""} sur ${questions.length}`
              : "Choisis ou écris au moins une réponse"
          }
          onClick={send}
        >
          <Send /> Envoyer
        </button>
        <button
          type="button"
          className="x"
          title="Fermer (répondre dans la saisie)"
          onClick={() =>
            updateSheet(paneKey, replyId, (s) => ({ ...s, closed: true }))
          }
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
                {q.body}
              </div>
            )}
            {q.recommendation && (
              <div className="qr">➡️ {q.recommendation}</div>
            )}
            <div className="opts">
              {q.recommendation && (
                <button
                  type="button"
                  className={`opt reco${a.reco ? " on" : ""}`}
                  onClick={() =>
                    a.reco
                      ? set(q.id, { reco: false })
                      : pickAndGo({ reco: true, option: undefined })
                  }
                >
                  OK pour ta reco
                </button>
              )}
              {q.options.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  className={`opt${a.option === o.key ? " on" : ""}${q.recommendedKey === o.key ? " rec" : ""}`}
                  title={q.recommendedKey === o.key ? "Recommandé" : undefined}
                  onClick={() =>
                    a.option === o.key
                      ? set(q.id, { option: undefined })
                      : pickAndGo({ option: o.key, reco: false })
                  }
                >
                  <b>{o.key})</b> {o.label}
                </button>
              ))}
            </div>
            <div className="free">
              <textarea
                rows={1}
                value={a.text ?? ""}
                placeholder="Ta réponse (Ctrl+Espace : dicter)"
                onChange={(e) => set(q.id, { text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === " " && e.ctrlKey) {
                    e.preventDefault();
                    if (!e.repeat) dictate(q.id);
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
              <button
                type="button"
                className={`mic${listening ? " rec" : ""}`}
                title={listening ? "Arrêter la dictée" : "Dicter ici"}
                disabled={
                  voice.status === "transcribing" ||
                  (voice.status !== "idle" && dictating !== q.id)
                }
                onClick={() => dictate(q.id)}
              >
                {listening ? <Square /> : <Mic />}
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
          {dictating} : {voice.interim}
        </div>
      )}
    </div>
  );
}
