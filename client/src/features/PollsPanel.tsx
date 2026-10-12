import { useState } from 'react';
import { LIMITS } from '@watch-party/shared';
import { useMe, useRoom, useSession } from '../lib/context';

export function PollsPanel() {
  const session = useSession();
  const polls = useRoom((r) => r.polls);
  const { memberId, isHost } = useMe();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await session.createPoll(question, options.filter((o) => o.trim()));
    if (res.ok) {
      setQuestion('');
      setOptions(['', '']);
    }
  };

  return (
    <div className="polls">
      <form className="poll-form" onSubmit={create}>
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask the room something…" maxLength={200} />
        {options.map((o, i) => (
          <input
            key={i}
            value={o}
            maxLength={100}
            placeholder={`Option ${i + 1}`}
            onChange={(e) => setOptions((opts) => opts.map((x, j) => (j === i ? e.target.value : x)))}
          />
        ))}
        <div className="row">
          {options.length < LIMITS.maxPollOptions && (
            <button type="button" className="btn small" onClick={() => setOptions((o) => [...o, ''])}>
              + Option
            </button>
          )}
          <button className="btn primary small" disabled={!question.trim() || options.filter((o) => o.trim()).length < 2}>
            Start poll
          </button>
        </div>
      </form>

      {[...polls].reverse().map((poll) => {
        const total = poll.options.reduce((n, o) => n + o.votes.length, 0);
        const max = Math.max(...poll.options.map((o) => o.votes.length));
        return (
          <div key={poll.id} className={`poll ${poll.closed ? 'closed' : ''}`}>
            <div className="poll-q">
              {poll.question} {poll.closed && <span className="muted small">(closed)</span>}
            </div>
            {poll.options.map((o) => {
              const pct = total ? Math.round((o.votes.length / total) * 100) : 0;
              const mine = !!memberId && o.votes.includes(memberId);
              return (
                <button
                  key={o.id}
                  className={`poll-opt ${mine ? 'mine' : ''} ${poll.closed && o.votes.length === max && max > 0 ? 'winner' : ''}`}
                  disabled={poll.closed}
                  onClick={() => session.votePoll(poll.id, o.id)}
                >
                  <span className="poll-bar" style={{ width: `${pct}%` }} />
                  <span className="poll-label">{o.text}</span>
                  <span className="poll-count">
                    {o.votes.length} · {pct}%
                  </span>
                </button>
              );
            })}
            {!poll.closed && (isHost || poll.createdBy === memberId) && (
              <button className="btn small" onClick={() => session.closePoll(poll.id)}>
                Close poll
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
