'use client';

import { useTheme } from './ThemeProvider';

export default function HomeThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button className="home-theme-btn" onClick={toggleTheme} type="button">
      {theme === 'dark' ? '☽' : '☀'}
    </button>
  );
}
