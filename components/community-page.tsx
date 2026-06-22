"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "@/components/app-header";
import "@/app/community.css";
import { refreshNickname } from "@/lib/nickname";
import {
  formatTime,
  toDisplayMessage,
  type DisplayMessage,
} from "@/lib/message-utils";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { Message } from "@/lib/supabase/types";

const MAX_LENGTH = 500;

function SendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M22 2L11 13"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M22 2L15 22L11 13L2 9L22 2Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MessageItem({ message }: { message: DisplayMessage }) {
  return (
    <li className="message">
      <div className="message__body">
        <div className="message__header">
          <span className="message__name">{message.nickname}</span>
          <time
            className="message__time"
            dateTime={message.createdAt.toISOString()}
          >
            {formatTime(message.createdAt)}
          </time>
        </div>
        <p className="message__text">{message.content}</p>
      </div>
    </li>
  );
}

export default function CommunityPage() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nicknameRef = useRef("");
  const feedRef = useRef<HTMLElement>(null);
  const supabase = useMemo(
    () => (isSupabaseConfigured() ? createClient() : null),
    []
  );

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const feed = feedRef.current;
    if (!feed) return;
    feed.scrollTo({ top: feed.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    if (loading || messages.length === 0) return;

    const id = requestAnimationFrame(() => {
      scrollToBottom();
      requestAnimationFrame(() => scrollToBottom());
    });

    return () => cancelAnimationFrame(id);
  }, [loading, messages, scrollToBottom]);

  const mapRows = useCallback((rows: Message[]) => {
    return rows.map((row) => toDisplayMessage(row, nicknameRef.current));
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      setError(
        ".env.local에 NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY를 설정해 주세요."
      );
      return;
    }

    const client = supabase;
    nicknameRef.current = refreshNickname();

    async function loadMessages() {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await client
        .from("messages")
        .select("*")
        .order("created_at", { ascending: true });

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      setMessages(mapRows(data ?? []));
      setLoading(false);
    }

    loadMessages();

    const channel = client
      .channel("messages-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const row = payload.new as Message;
          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev;
            return [...prev, toDisplayMessage(row, nicknameRef.current)];
          });
          requestAnimationFrame(() => scrollToBottom("smooth"));
        }
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [mapRows, scrollToBottom, supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const content = input.trim();
    if (!content || sending) return;

    if (!supabase) return;

    setSending(true);
    setError(null);

    const { error: insertError } = await supabase.from("messages").insert({
      nickname: nicknameRef.current,
      content,
    });

    if (insertError) {
      setError(insertError.message);
      setSending(false);
      return;
    }

    setInput("");
    setSending(false);
  }

  const canSend = input.trim().length > 0 && !sending;

  return (
    <div className="community-app">
      <AppHeader title="커뮤니티" showBackButton />

      <main className="feed" ref={feedRef} aria-live="polite">
        {error && (
          <p className="feed__error" role="alert">
            {error}
          </p>
        )}

        {loading ? (
          <div className="feed__empty">
            <p>불러오는 중…</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="feed__empty">
            <p>아직 글이 없어요.</p>
            <p className="feed__empty-sub">첫 번째 인사를 남겨보세요!</p>
          </div>
        ) : (
          <ul className="feed__list">
            {messages.map((message) => (
              <MessageItem key={message.id} message={message} />
            ))}
          </ul>
        )}
      </main>

      <footer className="composer">
        <form className="composer__form" onSubmit={handleSubmit}>
          <div className="composer__box">
            <textarea
              className="composer__input"
              placeholder="무슨 생각을 하고 있나요?"
              rows={1}
              maxLength={MAX_LENGTH}
              value={input}
              aria-label="메시지 입력"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (canSend) handleSubmit(e);
                }
              }}
            />
            <div className="composer__meta">
              <span
                className={`composer__count${
                  input.length >= MAX_LENGTH - 50 ? " composer__count--warn" : ""
                }`}
              >
                {input.length} / {MAX_LENGTH}
              </span>
              <button
                type="submit"
                className="composer__send"
                disabled={!canSend}
                aria-label="보내기"
              >
                <SendIcon />
              </button>
            </div>
          </div>
        </form>
      </footer>
    </div>
  );
}
