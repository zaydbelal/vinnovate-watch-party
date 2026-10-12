import { useEffect, useRef, useState } from 'react';
import { LIMITS } from '@watch-party/shared';
import { useRoom, useSession } from '../lib/context';

export function ChatPanel() {
  const session = useSession();
  const chat = useRoom((r) => r.chat);
  const members = useRoom((r) => r.members);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const res = await session.sendChat(text);
    if (res.ok) setText('');
  };

  return (
    <div className="chat">
      <div className="chat-list" ref={listRef}>
        {chat.map((m) =>
          m.system ? (
            <div key={m.id} className="chat-system">
              {m.text}
            </div>
          ) : (
            <div key={m.id} className="chat-msg">
              <span className="chat-name" style={{ color: members.find((x) => x.id === m.memberId)?.color }}>
                {m.name}
              </span>
              <span className="chat-time">{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <div className="chat-text">{m.text}</div>
            </div>
          ),
        )}
      </div>
      <form className="row" onSubmit={send}>
        <input value={text} maxLength={LIMITS.maxChatLength} onChange={(e) => setText(e.target.value)} placeholder="Say something…" />
        <button className="btn primary">Send</button>
      </form>
    </div>
  );
}
