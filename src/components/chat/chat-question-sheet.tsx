import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, CircleHelp, Mic, Send, Square, X } from "lucide-react";
import type { ChatVoice } from "@/components/chat/chat-composer";
import { redirectDictation } from "@/lib/chat/chatDrafts";
import {
  lastReplyRound,
  roundReply,
  type RoundAnswer,
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
 * in its text (`chatQuestionRound`): per question, « OK pour ta reco », its
 * options, a free field (dictation lands in the one that started it). One
 * « Envoyer » answers them all, « Q1 : … » per line. Closable.
 */
export function ChatQuestionSheet({
  paneKey,
  items,
  voice,
  onSend,
}: {
  /** The pane: answers and « closed » outlive its unmounts. */
  paneKey: string;
  items: ChatItem[];
  voice: ChatVoice;
  onSend: (text: string) => void;
}) {
  const round = useMemo(() => lastReplyRound(items), [items]);
  const replyId = round?.id ?? "";
  const sheet = useSheetAnswers(paneKey, replyId);
  const [folded, setFolded] = useState(false);
  /** The field a dictation of the sheet writes to, while it runs. */
  const [dictating, setDictating] = useState<string | null>(null);

  // The dictation over (text in, failed or cancelled): no field waits for
  // it (the pane clears the target too, `ChatPane`).
  const status = voice.status;
  useEffect(() => {
    if (status === "idle") setDictating(null);
  }, [status]);
  // Closed, gone (Claude answers, a request comes) or replaced by another
  // round: no field of it takes a dictation, which goes to the draft.
  const open = round !== null && !sheet.closed;
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
  const set = (id: string, patch: RoundAnswer) =>
    updateSheet(paneKey, replyId, (s) => ({
      ...s,
      answers: { ...s.answers, [id]: { ...s.answers[id], ...patch } },
    }));
  const reply = roundReply(questions, sheet.answers);
  const answered = questions.filter((q) =>
    roundReply([q], sheet.answers),
  ).length;

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

  return (
    <div className={`chat-sheet-q${folded ? " folded" : ""}`}>
      <div className="hd">
        <button
          type="button"
          className="fold"
          title={folded ? "Déplier" : "Replier"}
          onClick={() => setFolded((f) => !f)}
        >
          <CircleHelp />
          <b>
            {questions.length} question{questions.length > 1 ? "s" : ""} de
            Claude
          </b>
          <span>
            {answered > 0
              ? `· ${answered} répondue${answered > 1 ? "s" : ""}`
              : ""}
          </span>
          <ChevronDown className="chev" />
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
        <>
          <div className="qs">
            {questions.map((q) => {
              const a = sheet.answers[q.id] ?? {};
              const listening = dictating === q.id && voice.status !== "idle";
              return (
                <div key={q.id} className="q">
                  <div className="qt">
                    <span className="id">{q.id}</span>
                    {q.title}
                  </div>
                  {q.body && <div className="qb">{q.body}</div>}
                  {q.recommendation && (
                    <div className="qr">➡️ {q.recommendation}</div>
                  )}
                  <div className="opts">
                    {q.recommendation && (
                      <button
                        type="button"
                        className={`opt reco${a.reco ? " on" : ""}`}
                        onClick={() =>
                          set(q.id, { reco: !a.reco, option: undefined })
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
                        title={
                          q.recommendedKey === o.key ? "Recommandé" : undefined
                        }
                        onClick={() =>
                          set(q.id, {
                            option: a.option === o.key ? undefined : o.key,
                            reco: false,
                          })
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
                </div>
              );
            })}
          </div>
          <div className="ft">
            <span>{reply ? "" : "Choisis ou écris au moins une réponse"}</span>
            <button
              type="button"
              className="chat-btn primary"
              disabled={!reply}
              onClick={send}
            >
              <Send /> Envoyer
            </button>
          </div>
        </>
      )}
    </div>
  );
}
