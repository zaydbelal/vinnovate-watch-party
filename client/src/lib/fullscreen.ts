/**
 * Fullscreen that works everywhere. Uses the Fullscreen API (standard or
 * Safari's webkit-prefixed one); where a page can't go fullscreen at all
 * (iPhone Safari), the caller falls back to "pseudo fullscreen": it adds
 * .pseudo-fs (styles.css) through React state, which pins the element over
 * the window. (Adding the class here would be wiped by React's next render.)
 */
type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export function fullscreenElement(): Element | null {
  const d = document as FsDocument;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

/** Returns true for real fullscreen, false if the caller should use pseudo fullscreen. */
export async function enterFullscreen(el: HTMLElement): Promise<boolean> {
  const e = el as FsElement;
  try {
    if (e.requestFullscreen && document.fullscreenEnabled !== false) {
      await e.requestFullscreen();
      return true;
    }
    if (e.webkitRequestFullscreen) {
      await e.webkitRequestFullscreen();
      return true;
    }
  } catch {
    /* refused (e.g. iframe policy): fall back to pseudo */
  }
  return false;
}

export function exitFullscreen(): void {
  const d = document as FsDocument;
  if (d.fullscreenElement) void d.exitFullscreen().catch(() => {});
  else if (d.webkitFullscreenElement) void d.webkitExitFullscreen?.();
}

export function onFullscreenChange(cb: () => void): () => void {
  document.addEventListener('fullscreenchange', cb);
  document.addEventListener('webkitfullscreenchange', cb);
  return () => {
    document.removeEventListener('fullscreenchange', cb);
    document.removeEventListener('webkitfullscreenchange', cb);
  };
}
