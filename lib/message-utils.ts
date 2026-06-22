import type { Message } from "@/lib/supabase/types";

export function formatTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);

  if (mins < 1) return "방금";
  if (mins < 60) return `${mins}분 전`;
  if (hours < 24) return `${hours}시간 전`;

  return date.toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function toDisplayMessage(row: Message, myNickname: string) {
  return {
    id: row.id,
    nickname: row.nickname,
    content: row.content,
    createdAt: new Date(row.created_at),
    isMine: row.nickname === myNickname,
  };
}

export type DisplayMessage = ReturnType<typeof toDisplayMessage>;
