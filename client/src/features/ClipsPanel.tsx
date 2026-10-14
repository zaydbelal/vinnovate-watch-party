import { useRef, useState } from 'react';
import { formatTime, type Clip } from '@watch-party/shared';
import { RangePreview } from '../components/RangePreview';
import { downloadBlob, exportClip } from '../lib/clipExport';
import { useMe, useRoom, useSession } from '../lib/context';

/** Shared moments: replay locally, replay for the room, or download (video files). */
export function ClipsPanel() {
  const clips = useRoom((r) => r.clips);
  if (clips.length === 0) {
    return (
      <p className="muted empty">
        Press Clip under the video (or C) to save the last 15–90 seconds. Everyone in the room can rewatch it here.
      </p>
    );
  }
  return (
    <ul className="clips">
      {[...clips].reverse().map((c) => (
        <ClipRow key={c.id} clip={c} />
      ))}
    </ul>
  );
}

function ClipRow({ clip }: { clip: Clip }) {
  const session = useSession();
  const author = useRoom((r) => r.members.find((m) => m.id === clip.createdBy)?.name ?? 'someone');
  const currentMediaId = useRoom((r) => r.playback.media?.id);
  const { memberId, isHost, canControl } = useMe();
  const [previewing, setPreviewing] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);

  const download = async () => {
    abort.current = new AbortController();
    setProgress(0);
    try {
      const blob = await exportClip(clip.source.url, clip.start, clip.end, setProgress, abort.current.signal);
      const safe = clip.mediaTitle.replace(/[^\w-]+/g, '-').slice(0, 40);
      downloadBlob(blob, `${safe}-${Math.floor(clip.start)}s.webm`);
    } catch (e) {
      if ((e as Error).message !== 'Cancelled') session.notify('error', (e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  return (
    <li className="clip">
      <div className="clip-head">
        <div>
          <div className="clip-title">{clip.mediaTitle}</div>
          <div className="muted small">
            {formatTime(clip.start)}–{formatTime(clip.end)} · {Math.round(clip.end - clip.start)} s · by {clip.createdBy === memberId ? 'you' : author}
          </div>
        </div>
      </div>
      {previewing && <RangePreview source={clip.source} start={clip.start} end={clip.end} />}
      <div className="row wrap">
        <button className="btn small" onClick={() => setPreviewing((p) => !p)}>
          {previewing ? 'Close' : 'Watch'}
        </button>
        {canControl && currentMediaId === clip.mediaId && (
          <button className="btn small ghost" onClick={() => void session.seek(clip.start)} title="Jump the whole room to this moment">
            Replay for everyone
          </button>
        )}
        {clip.source.kind === 'html5' &&
          (progress == null ? (
            <button className="btn small ghost" onClick={() => void download()} title="Records the clip in real time">
              Download
            </button>
          ) : (
            <button className="btn small ghost" onClick={() => abort.current?.abort()}>
              Saving {Math.round(progress * 100)}% · Cancel
            </button>
          ))}
        {(isHost || clip.createdBy === memberId) && (
          <button className="btn small ghost" onClick={() => void session.removeClip(clip.id)}>
            Remove
          </button>
        )}
      </div>
    </li>
  );
}
