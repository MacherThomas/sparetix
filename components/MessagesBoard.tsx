"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  formatDate,
  formatDateTime,
  formatPrice,
  toNumber,
  type Conversation,
  type Message,
} from "@/lib/listings";

type ConversationRow = Conversation & {
  event: { id: string; name: string; event_date: string | null } | null;
  ticket: { id: string; price: number | null; contact: string | null } | null;
  request: { id: string; contact: string | null } | null;
};

// How often to check for new messages while the page is visible.
const POLL_MS = 8000;
// Recent messages across all conversations, for previews and unread badges.
const RECENT_LIMIT = 500;
// Newest messages loaded for the open conversation.
const THREAD_LIMIT = 500;

export default function MessagesBoard({ userId }: { userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  // The open conversation lives in the URL (?c=), so Back and the header link close it.
  const selectedId = useSearchParams().get("c");

  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [recent, setRecent] = useState<Message[]>([]);
  // The open thread, tagged with its conversation so late responses can't show in another one.
  const [threadState, setThreadState] = useState<{ id: string; messages: Message[] } | null>(null);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);

  const threadHeadingRef = useRef<HTMLHeadingElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastUnreadTotal = useRef<number | null>(null);
  // Where focus should go once the view for the new URL has rendered.
  const pendingFocus = useRef<string | null>(null);

  const loadList = useCallback(async () => {
    const [convRes, msgRes] = await Promise.all([
      supabase
        .from("conversations")
        .select(
          "*, event:events(id, name, event_date), ticket:tickets(id, price, contact), request:requests(id, contact)"
        )
        .order("created_at", { ascending: false }),
      supabase.from("messages").select("*").order("created_at", { ascending: false }).limit(RECENT_LIMIT),
    ]);
    const failed = convRes.error ?? msgRes.error;
    if (failed) setLoadError(failed.message);
    else {
      setLoadError(null);
      setConversations((convRes.data ?? []) as ConversationRow[]);
      setRecent(((msgRes.data ?? []) as Message[]).reverse());
    }
    setLoading(false);
  }, [supabase]);

  const loadThread = useCallback(
    async (id: string) => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", id)
        .order("created_at", { ascending: false })
        .limit(THREAD_LIMIT);
      if (error) setLoadError(error.message);
      else if (selectedIdRef.current === id) setThreadState({ id, messages: ((data ?? []) as Message[]).reverse() });
    },
    [supabase]
  );

  // Pause polling while the tab is hidden, so messages aren't marked read unseen.
  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState === "visible");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // A newly opened conversation starts scrolled to the newest message.
  useEffect(() => {
    stickToBottom.current = true;
  }, [selectedId]);

  useEffect(() => {
    if (!visible) return;
    const refresh = () => {
      loadList();
      if (selectedId) loadThread(selectedId);
    };
    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(timer);
  }, [visible, selectedId, loadList, loadThread]);

  const lastByConversation = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of recent) map.set(m.conversation_id, m);
    return map;
  }, [recent]);

  const unreadByConversation = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of recent) {
      if (m.sender_id !== userId && !m.read_at) map.set(m.conversation_id, (map.get(m.conversation_id) ?? 0) + 1);
    }
    return map;
  }, [recent, userId]);

  // Keep the header's unread badge in step with what the page has seen.
  const unreadTotal = useMemo(
    () => [...unreadByConversation.values()].reduce((sum, n) => sum + n, 0),
    [unreadByConversation]
  );
  useEffect(() => {
    if (lastUnreadTotal.current !== null && lastUnreadTotal.current !== unreadTotal) router.refresh();
    lastUnreadTotal.current = unreadTotal;
  }, [unreadTotal, router]);

  // Most recent activity first.
  const sorted = useMemo(() => {
    const lastAt = (c: ConversationRow) => lastByConversation.get(c.id)?.created_at ?? c.created_at;
    return [...conversations].sort((a, b) => lastAt(b).localeCompare(lastAt(a)));
  }, [conversations, lastByConversation]);

  const selected = sorted.find((c) => c.id === selectedId) ?? null;
  const draft = selected ? (drafts[selected.id] ?? "") : "";
  const threadLoaded = threadState !== null && threadState.id === selectedId;
  const thread = useMemo(() => (threadLoaded ? threadState.messages : []), [threadLoaded, threadState]);

  // Move focus once the new view exists (after opening or closing a conversation).
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    if (target === "thread" && selected) threadHeadingRef.current?.focus();
    else if (target !== "thread" && !selectedId) document.getElementById(target)?.focus();
    else return;
    pendingFocus.current = null;
  }, [selectedId, selected]);

  // Mark incoming messages read while the conversation is open and the tab is visible.
  const threadUnread = thread.filter((m) => m.sender_id !== userId && !m.read_at).length;
  useEffect(() => {
    if (!selected || !visible || threadUnread === 0) return;
    const now = new Date().toISOString();
    supabase
      .from("messages")
      .update({ read_at: now })
      .eq("conversation_id", selected.id)
      .neq("sender_id", userId)
      .is("read_at", null)
      .then(({ error }) => {
        if (error) return;
        const markRead = (list: Message[]) =>
          list.map((m) =>
            m.conversation_id === selected.id && m.sender_id !== userId && !m.read_at ? { ...m, read_at: now } : m
          );
        setThreadState((prev) => (prev ? { id: prev.id, messages: markRead(prev.messages) } : prev));
        setRecent(markRead);
      });
  }, [selected, visible, threadUnread, supabase, userId]);

  // Scroll only the log (never the page), and only if the reader was already at the bottom.
  useEffect(() => {
    const log = logRef.current;
    if (log && stickToBottom.current) log.scrollTop = log.scrollHeight;
  }, [thread.length, selected?.id]);

  function onLogScroll() {
    const log = logRef.current;
    if (log) stickToBottom.current = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
  }

  // Native pushState updates useSearchParams without a server round trip; Back still works.
  function openConversation(id: string) {
    setSendError(null);
    pendingFocus.current = "thread";
    window.history.pushState(null, "", `/app/messages?c=${id}`);
  }

  function closeConversation() {
    pendingFocus.current = `conversation-${selectedId}`;
    window.history.pushState(null, "", "/app/messages");
  }

  async function send(e: React.FormEvent | React.KeyboardEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!selected || !body || sendingRef.current) return;
    const id = selected.id;
    const sentDraft = draft;
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    const { data, error } = await supabase
      .from("messages")
      .insert({ conversation_id: id, sender_id: userId, body })
      .select()
      .single();
    sendingRef.current = false;
    setSending(false);
    requestAnimationFrame(() => draftRef.current?.focus());
    if (error) {
      setSendError(error.message);
      return;
    }
    const message = data as Message;
    stickToBottom.current = true;
    setThreadState((prev) => (prev && prev.id === id ? { id, messages: [...prev.messages, message] } : prev));
    setRecent((prev) => [...prev, message]);
    // Keep anything typed while the message was sending.
    setDrafts((prev) => (prev[id] === sentDraft ? { ...prev, [id]: "" } : prev));
  }

  function counterpart(c: ConversationRow) {
    if (c.seller_id === userId) {
      const contact = c.request?.contact;
      return `With someone looking for a ticket${contact ? ` (${contact})` : ""}`;
    }
    const price = c.ticket ? ` of the ${formatPrice(toNumber(c.ticket.price))} ticket` : "";
    const contact = c.ticket?.contact;
    return `With the seller${price}${contact ? ` (${contact})` : ""}`;
  }

  return (
    <div className="messages-page">
      <h1 className="sell-heading">Messages</h1>
      {loadError && (
        <p className="alert alert-error" role="alert">
          {loadError}
        </p>
      )}
      <div className={`messages ${selected ? "messages-has-thread" : ""}`}>
        <div className="messages-list-pane">
          <p className="status-text" role="status">
            {loading ? "Loading messages…" : ""}
          </p>
          {!loading && sorted.length === 0 && (
            <p className="empty-note">
              No messages yet. Use &ldquo;Message seller&rdquo; on a ticket, or &ldquo;Message&rdquo; next to someone
              looking for a ticket, to start a conversation. <Link href="/app">Go to tickets</Link>
            </p>
          )}
          <ul className="conversation-list" aria-label="Conversations">
            {sorted.map((c) => {
              const last = lastByConversation.get(c.id);
              const unread = unreadByConversation.get(c.id) ?? 0;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    id={`conversation-${c.id}`}
                    className={`conversation ${c.id === selectedId ? "conversation-active" : ""}`}
                    aria-current={c.id === selectedId ? "true" : undefined}
                    onClick={() => openConversation(c.id)}
                  >
                    <span className="conversation-event">{c.event?.name ?? "Event"}</span>
                    <span>{counterpart(c)}</span>
                    <span className="conversation-preview">
                      {last ? `${last.sender_id === userId ? "You: " : ""}${last.body}` : "No messages yet"}
                    </span>
                    {unread > 0 && <span className="unread-badge">{unread} new</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <section className="thread-pane" aria-labelledby="thread-heading">
          {selected ? (
            <>
              <button type="button" className="btn btn-text thread-back" onClick={closeConversation}>
                Back to conversations
              </button>
              <header className="thread-header">
                <h2 id="thread-heading" className="thread-title" tabIndex={-1} ref={threadHeadingRef}>
                  {selected.event?.name ?? "Event"}
                </h2>
                <p>
                  {formatDate(selected.event?.event_date ?? null)} · {counterpart(selected)}
                </p>
              </header>

              {!threadLoaded && (
                <p className="message-empty" role="status">
                  Loading conversation…
                </p>
              )}
              {/* Mounted only once loaded, so screen readers announce new messages, not the history. */}
              <div
                key={selected.id}
                ref={logRef}
                className="message-log"
                role="log"
                tabIndex={0}
                aria-label="Messages in this conversation"
                onScroll={onLogScroll}
                hidden={!threadLoaded}
              >
                {!threadLoaded ? null : thread.length === 0 ? (
                  <p className="message-empty">Say hello and ask about the ticket.</p>
                ) : (
                  <ol className="message-list">
                    {thread.map((m) => {
                      const mine = m.sender_id === userId;
                      return (
                        <li key={m.id} className={`message ${mine ? "message-mine" : "message-theirs"}`}>
                          <span className="message-meta">
                            {mine ? "You" : "Them"} · {formatDateTime(m.created_at)}
                          </span>
                          <span className="message-body">{m.body}</span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>

              <form onSubmit={send} className="composer">
                <label htmlFor="message-draft" className="label">
                  Your message
                </label>
                <textarea
                  id="message-draft"
                  ref={draftRef}
                  rows={3}
                  maxLength={2000}
                  value={draft}
                  onChange={(e) => {
                    const value = e.target.value;
                    setDrafts((prev) => ({ ...prev, [selected.id]: value }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(e);
                  }}
                  aria-describedby="message-hint"
                  placeholder="e.g. Is the ticket still available?"
                />
                <div className="composer-row">
                  <span className="hint" id="message-hint">
                    Never pay before you&apos;ve checked the ticket. Ctrl or ⌘ + Enter sends.
                  </span>
                  <button type="submit" className="btn btn-primary" disabled={sending || !draft.trim()}>
                    {sending ? "Sending…" : "Send"}
                  </button>
                </div>
                {sendError && (
                  <p className="alert alert-error" role="alert">
                    {sendError}
                  </p>
                )}
              </form>
            </>
          ) : (
            <>
              <h2 id="thread-heading" className="visually-hidden">
                No conversation open
              </h2>
              {sorted.length > 0 && <p className="thread-placeholder">Choose a conversation to read it.</p>}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
