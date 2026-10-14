import { useEffect, useRef, useState } from 'react';
import { LIMITS } from '@watch-party/shared';
import { Avatar } from '../components/ui';
import { useClient, useRoom, useSession } from '../lib/context';

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
      <VoiceBar />
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
      <form className="row chat-form" onSubmit={send}>
        <input value={text} maxLength={LIMITS.maxChatLength} onChange={(e) => setText(e.target.value)} placeholder="Say something" aria-label="Message" />
        <button className="btn primary">Send</button>
      </form>
    </div>
  );
}

/** Voice channel: join/leave, mute, and who's talking. Audio is peer-to-peer. */
function VoiceBar() {
  const session = useSession();
  const voiceIds = useRoom((r) => r.voice);
  const members = useRoom((r) => r.members);
  const voice = useClient((s) => s.voice);
  const inCall = members.filter((m) => voiceIds.includes(m.id));

  return (
    <div className="voice">
      <div className="voice-info">
        <span className="voice-label">Voice</span>
        {inCall.length ? (
          <span className="avatar-row">
            {inCall.map((m) => (
              <Avatar key={m.id} member={m} size={24} speaking={voice.speaking.includes(m.id)} />
            ))}
          </span>
        ) : (
          <span className="muted small">Nobody's talking yet</span>
        )}
      </div>
      {voice.joined ? (
        <div className="row">
          <button className={`btn small ${voice.muted ? 'primary' : ''}`} onClick={() => session.setVoiceMuted(!voice.muted)}>
            {voice.muted ? 'Unmute' : 'Mute'}
          </button>
          <button className="btn small ghost" onClick={session.leaveVoice}>
            Leave
          </button>
        </div>
      ) : (
        <button className="btn small" onClick={() => void session.joinVoice()}>
          Join voice
        </button>
      )}
    </div>
  );
}
