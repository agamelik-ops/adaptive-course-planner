"use client";

import { useEffect, useRef, useState } from "react";

type Message = { id: number; role: "assistant" | "user"; text: string };

const SUGGESTIONS = [
  "What intro CS classes fit a MWF schedule?",
  "Which courses count for Non-Western Cultures?",
  "Find me an afternoon language class",
];

const WELCOME: Message = {
  id: 0,
  role: "assistant",
  text: "Hi! I’m your course planning assistant. Ask me about Spring 2027 classes, requirements, or how to fit a course into your week.",
};

// TODO(data pipeline): replace this with a real call to the AI backend.
// It receives the full conversation so far and should resolve to the reply text.
async function getReply(history: Message[]): Promise<string> {
  void history;
  await new Promise((resolve) => setTimeout(resolve, 700));
  return "I’m not connected to the course data yet. Once the assistant is hooked up, I’ll be able to answer questions like this.";
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nextId = useRef(1);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  async function send(text: string) {
    const value = text.trim();
    if (!value || thinking) return;
    const userMessage: Message = { id: nextId.current++, role: "user", text: value };
    const history = [...messages, userMessage];
    setMessages(history);
    setDraft("");
    setThinking(true);
    try {
      const reply = await getReply(history);
      setMessages((current) => [...current, { id: nextId.current++, role: "assistant", text: reply }]);
    } catch {
      setMessages((current) => [...current, { id: nextId.current++, role: "assistant", text: "Sorry, something went wrong. Please try again." }]);
    } finally {
      setThinking(false);
    }
  }

  return (
    <div className="chat-widget">
      {open && (
        <section className="chat-panel" role="dialog" aria-label="Course planning assistant">
          <header className="chat-header">
            <div className="chat-avatar" aria-hidden="true">✦</div>
            <div>
              <strong>Planning Assistant</strong>
              <span>Ask about Spring 2027 courses</span>
            </div>
            <button className="chat-close" aria-label="Close chat" onClick={() => setOpen(false)}>×</button>
          </header>

          <div className="chat-messages" ref={listRef} aria-live="polite">
            {messages.map((message) => (
              <div key={message.id} className={`chat-bubble ${message.role}`}>{message.text}</div>
            ))}
            {thinking && (
              <div className="chat-bubble assistant chat-typing" aria-label="Assistant is typing">
                <span /><span /><span />
              </div>
            )}
            {messages.length === 1 && !thinking && (
              <div className="chat-suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} onClick={() => send(suggestion)}>{suggestion}</button>
                ))}
              </div>
            )}
          </div>

          <form className="chat-input" onSubmit={(event) => { event.preventDefault(); send(draft); }}>
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              placeholder="Ask a question…"
              aria-label="Message"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send(draft);
                }
              }}
            />
            <button type="submit" aria-label="Send message" disabled={!draft.trim() || thinking}>↑</button>
          </form>
        </section>
      )}

      <button
        className={`chat-launcher${open ? " is-open" : ""}`}
        aria-label={open ? "Close planning assistant" : "Open planning assistant"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "×" : (
          <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
            <path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm3 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />
          </svg>
        )}
      </button>
    </div>
  );
}
