/**
 * Render a clip of a direct video file to a downloadable WebM.
 *
 * A hidden <video> plays the range once while MediaRecorder captures it
 * (audio is routed through Web Audio so nothing plays out loud). It runs in
 * real time, so a 30 s clip takes 30 s. Only works when the video host sends
 * CORS headers; otherwise the clip stays a shared moment you can replay.
 */
export async function exportClip(url: string, start: number, end: number, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<Blob> {
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record clips');
  const video = document.createElement('video') as HTMLVideoElement & { captureStream?: () => MediaStream };
  video.crossOrigin = 'anonymous';
  video.preload = 'auto';
  video.playsInline = true;
  video.src = url;

  await once(video, 'loadedmetadata', 'This video does not allow downloads (no CORS). The clip is still saved for the room.');
  video.currentTime = start;
  await once(video, 'seeked');
  if (!video.captureStream) throw new Error('This browser cannot record clips');

  const audioCtx = new AudioContext();
  const dest = audioCtx.createMediaStreamDestination();
  audioCtx.createMediaElementSource(video).connect(dest); // not to speakers
  const stream = new MediaStream([...video.captureStream().getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const finished = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }));
  });
  const stop = () => {
    if (recorder.state !== 'inactive') recorder.stop();
    video.pause();
  };
  signal?.addEventListener('abort', stop);
  video.addEventListener('timeupdate', () => {
    onProgress(Math.min(1, (video.currentTime - start) / (end - start)));
    if (video.currentTime >= end) stop();
  });
  video.addEventListener('ended', stop);

  recorder.start(1000);
  await video.play();
  const blob = await finished;
  void audioCtx.close();
  video.removeAttribute('src');
  video.load();
  if (signal?.aborted) throw new Error('Cancelled');
  return blob;
}

function once(el: HTMLMediaElement, event: string, errorMessage = 'Could not load video'): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => (cleanup(), resolve());
    const fail = () => (cleanup(), reject(new Error(errorMessage)));
    const cleanup = () => {
      el.removeEventListener(event, ok);
      el.removeEventListener('error', fail);
    };
    el.addEventListener(event, ok);
    el.addEventListener('error', fail);
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
