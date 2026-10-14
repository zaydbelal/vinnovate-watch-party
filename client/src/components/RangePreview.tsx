import { STREAMING_PROVIDERS, formatTime, streamingDeepLink, type MediaSource } from '@watch-party/shared';
import { previewSrc } from '../lib/media';

/** Local, unsynced preview of part of a video. Only you see and hear it. */
export function RangePreview({ source, start, end }: { source: MediaSource; start: number; end: number }) {
  const src = previewSrc(source, start, end);
  if (!src) {
    const name = source.provider ? STREAMING_PROVIDERS[source.provider].name : 'the service';
    return (
      <div className="preview preview-external">
        <a className="btn small" href={streamingDeepLink(source, start)} target="_blank" rel="noopener noreferrer">
          Open in {name} at {formatTime(start)}
        </a>
      </div>
    );
  }
  return (
    <div className="preview">
      {source.kind === 'youtube' ? (
        <iframe src={src} title="Preview" allow="autoplay; encrypted-media" allowFullScreen />
      ) : (
        <video src={src} controls autoPlay playsInline />
      )}
    </div>
  );
}
