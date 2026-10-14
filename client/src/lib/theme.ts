import { useEffect, useState } from 'react';

/** `brutal` is the stark backup theme (mono type, heavy borders, square corners, no easing). */
export const THEMES = ['light', 'dark', 'brutal'] as const;
export type Theme = (typeof THEMES)[number];
const KEY = 'wp:theme';

/** Saved choice, else the OS preference. index.html applies it before first paint. */
export function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if ((THEMES as readonly string[]).includes(saved ?? '')) return saved as Theme;
  } catch {
    /* storage blocked */
  }
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return [theme, setTheme];
}
