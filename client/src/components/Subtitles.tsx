import { useEffect, useRef, useState } from 'react';
import { SUBTITLES, cueAt, parseSubtitles, type Cue } from '@watch-party/shared';

type Size = keyof typeof SUBTITLES.sizes;

export interface SubtitleTrack {
  name: string;
  cues: Cue[];
}

export interface SubtitleState {
  track: SubtitleTrack | null;
  on: boolean;
  size: Size;
  /** Seconds added to the video time when picking a line (positive = later). */
  offset: number;
}

/**
 * Loaded subtitles are kept per video for this tab, so switching videos and
 * coming back keeps them. They never leave this browser.
 */
const loaded = new Map<string, SubtitleTrack>();
const SIZE_KEY = 'wp:subsize';

function savedSize(): Size {
  try {
    const s = localStorage.getItem(SIZE_KEY);
    if (s && s in SUBTITLES.sizes) return s as Size;
  } catch {
    /* storage blocked */
  }
  return SUBTITLES.defaultSize;
}

/** Personal subtitle state for the video identified by `mediaKey`. */
type Patch = Partial<SubtitleState> | ((s: SubtitleState) => Partial<SubtitleState>);

export function useSubtitles(mediaKey: string | null): [SubtitleState, (patch: Patch) => void, (file: File) => Promise<string | null>] {
  const [state, setState] = useState<SubtitleState>(() => ({ track: null, on: true, size: savedSize(), offset: 0 }));
  useEffect(() => {
    setState((s) => ({ ...s, track: mediaKey ? (loaded.get(mediaKey) ?? null) : null, offset: 0, on: true }));
  }, [mediaKey]);

  // Functional patches (e.g. the timing nudge) apply against the latest state, so fast clicks all count.
  const update = (patchOrFn: Patch) => {
    if (typeof patchOrFn === 'function') {
      setState((s) => ({ ...s, ...patchOrFn(s) }));
      return;
    }
    const patch = patchOrFn;
    setState((s) => ({ ...s, ...patch }));
    if (patch.size) {
      try {
        localStorage.setItem(SIZE_KEY, patch.size);
      } catch {
        /* ignore */
      }
    }
    if ('track' in patch && mediaKey) {
      if (patch.track) loaded.set(mediaKey, patch.track);
      else loaded.delete(mediaKey);
    }
  };

  /** Read and parse a file; returns an error message, or null on success. */
  const load = async (file: File): Promise<string | null> => {
    if (file.size > SUBTITLES.maxFileBytes) return 'That file is too big for a subtitle file';
    const cues = parseSubtitles(await file.text());
    if (cues.length === 0) return 'No subtitles found in that file (use .srt or .vtt)';
    update({ track: { name: file.name, cues }, on: true, offset: 0 });
    return null;
  };

  return [state, update, load];
}

/** Draws the current line over the video, read from the player clock every frame. */
export function SubtitleOverlay({ state, getTime }: { state: SubtitleState; getTime: () => number }) {
  const [text, setText] = useState('');
  const [height, setHeight] = useState(360);
  const last = useRef('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cues = state.track?.cues;
    if (!cues || !state.on) {
      last.current = '';
      setText('');
      return;
    }
    let raf = 0;
    const tick = () => {
      const t = cueAt(cues, getTime() - state.offset);
      if (t !== last.current) {
        last.current = t;
        setText(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state.track, state.on, state.offset, getTime]);

  // Text scales with the video frame, so it stays readable in fullscreen and on phones.
  useEffect(() => {
    const frame = box.current?.parentElement;
    if (!frame) return;
    const ro = new ResizeObserver(([e]) => setHeight(e.contentRect.height));
    ro.observe(frame);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="subtitles" ref={box} style={{ fontSize: Math.max(12, height * SUBTITLES.sizes[state.size]) }}>
      {text && text.split('\n').map((line, i) => (
        <span key={i}>{line}</span>
      ))}
    </div>
  );
}

/** CC button: load a file, on/off, size, timing nudge, remove. Only you see the result. */
export function SubtitleMenu({ state, update, load, onError, disabled }: {
  state: SubtitleState;
  update: (patch: Patch) => void;
  load: (file: File) => Promise<string | null>;
  onError: (message: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const err = await load(file);
    if (err) onError(err);
  };
  const step = SUBTITLES.offsetStepSec;
  const active = !!state.track && state.on;

  return (
    <div className="clip-menu" ref={ref}>
      <button
        className={`btn small ${active ? 'primary' : 'ghost'}`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Personal subtitles (only you see them)"
      >
        CC
      </button>
      <input ref={fileRef} type="file" accept=".srt,.vtt,text/vtt,application/x-subrip" hidden onChange={(e) => void pick(e)} />
      {open && (
        <div className="popover subs-menu" role="dialog" aria-label="Subtitles">
          {!state.track ? (
            <>
              <span className="muted small">Subtitles just for you</span>
              <button className="btn small" onClick={() => fileRef.current?.click()}>
                Load .srt or .vtt
              </button>
            </>
          ) : (
            <>
              <span className="small ellipsis subs-name" title={state.track.name}>
                {state.track.name}
              </span>
              <div className="row">
                <button className={`btn small ${state.on ? 'primary' : ''}`} onClick={() => update({ on: !state.on })} aria-pressed={state.on}>
                  {state.on ? 'On' : 'Off'}
                </button>
                {(Object.keys(SUBTITLES.sizes) as Size[]).map((s) => (
                  <button key={s} className={`btn small ${state.size === s ? 'primary' : ''}`} onClick={() => update({ size: s })} aria-pressed={state.size === s}>
                    {s}
                  </button>
                ))}
              </div>
              <div className="row">
                <button className="btn small" onClick={() => update((s) => ({ offset: s.offset - step }))} title="Show subtitles earlier">
                  −{step}s
                </button>
                <span className="small subs-offset" title="Timing shift">
                  {state.offset >= 0 ? '+' : ''}
                  {state.offset.toFixed(1)}s
                </span>
                <button className="btn small" onClick={() => update((s) => ({ offset: s.offset + step }))} title="Show subtitles later">
                  +{step}s
                </button>
              </div>
              <div className="row">
                <button className="btn small ghost" onClick={() => fileRef.current?.click()}>
                  Replace
                </button>
                <button className="btn small ghost" onClick={() => update({ track: null })}>
                  Remove
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
