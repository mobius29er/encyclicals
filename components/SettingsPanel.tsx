'use client';

import { useTheme } from './ThemeProvider';

interface SettingsPanelProps {
  isOpen: boolean;
  fontSize: number;
  onSetFontSize: (n: number) => void;
  ndOn: boolean;
  onToggleND: () => void;
}

export default function SettingsPanel({ isOpen, fontSize, onSetFontSize, ndOn, onToggleND }: SettingsPanelProps) {
  const { setTheme } = useTheme();

  return (
    <div className={`panel${isOpen ? ' open' : ''}`}>
      <div className="panel-label">Text Size</div>
      <div className="panel-row">
        <button className="ibtn" onClick={() => onSetFontSize(16)} type="button">A−</button>
        <button
          className={`ibtn${fontSize === 18 ? ' ibtn-active' : ''}`}
          onClick={() => onSetFontSize(18)}
          type="button"
        >
          A
        </button>
        <button className="ibtn" onClick={() => onSetFontSize(21)} type="button">A+</button>
      </div>
      <div className="panel-label">Reading Mode</div>
      <div className="panel-row">
        <button
          className={`ibtn ibtn-sm${ndOn ? ' nd-active' : ''}`}
          onClick={onToggleND}
          type="button"
          aria-pressed={ndOn}
        >
          Focus / ND
        </button>
      </div>
      <div className="panel-hint">Bionic reading + sentence breaks</div>
      <div className="panel-label">Theme</div>
      <div className="panel-row">
        <button className="ibtn" onClick={() => setTheme('light')} type="button">Light</button>
        <button className="ibtn" onClick={() => setTheme('dark')} type="button">Dark</button>
      </div>
    </div>
  );
}
