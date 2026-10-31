import type { ChatItem } from "@/lib/chat/chatState";

type NoticeItem = Extract<ChatItem, { kind: "notice" }>;

/**
 * A line of Claude Code's or the chat's own in the column: a short pill, or
 * a quiet block when Claude Code's words come with it (a hook's reason, why
 * an action was refused, an error's text).
 */
export function ChatNoticeRow({ item }: { item: NoticeItem }) {
  const tone = item.tone === "info" ? "" : ` ${item.tone}`;
  if (!item.detail) {
    return <div className={`chat-unit chat-notice${tone}`}>{item.text}</div>;
  }
  return (
    <div className={`chat-unit chat-notice-block${tone}`}>
      <div className="text">{item.text}</div>
      <div className="detail">{item.detail}</div>
    </div>
  );
}
