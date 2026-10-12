/** Persistence of the user's display name and per-room session ids. */

const NAME_KEY = 'wp:name';

export function getSavedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* storage unavailable: name just won't be remembered */
  }
}

// Session ids live in sessionStorage: they survive a refresh (so you keep your
// seat and host role) but two tabs are two different people.
export function getSessionId(code: string): string | undefined {
  try {
    return sessionStorage.getItem(`wp:session:${code}`) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveSessionId(code: string, id: string): void {
  try {
    sessionStorage.setItem(`wp:session:${code}`, id);
  } catch {
    /* ignore */
  }
}
