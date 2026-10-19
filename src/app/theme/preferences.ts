import { useLayoutEffect, useState } from 'react';
import type { ViewTheme } from '../../graphics/view-theme.ts';
const themeKey = 'nnfig.ui.theme';
function storedTheme(): ViewTheme {
  try {
    return localStorage.getItem(themeKey) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}
/** UI preference only: deliberately independent from ProjectDocument and undo. */
export function useEditorTheme() {
  const [theme, setValue] = useState<ViewTheme>(storedTheme);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const setTheme = (next: ViewTheme) => {
    setValue(next);
    try {
      localStorage.setItem(themeKey, next);
    } catch {
      /* Still usable for this session. */
    }
  };
  return { theme, setTheme };
}
