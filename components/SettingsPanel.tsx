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
        <button
          className="ibtn"
          onClick={() => onSetFontSize(16)}
          style={{ flex: 1, height: 34, fontSize: 13, border: '1px solid var(--rule)', borderRadius: 6 }}
          type="button"
        >
          A−
        </button>
        <button
          className="ibtn"
          onClick={() => onSetFontSize(18)}
          style={{
            flex: 1,
            height: 34,
            fontSize: fontSize === 18 ? 15 : 13,
            border: '1px solid var(--rule)',
            borderRadius: 6,
          }}
          type="button"
        >
          A
        </button>
        <button
          className="ibtn"
          onClick={() => onSetFontSize(21)}
          style={{ flex: 1, height: 34, fontSize: 13, border: '1px solid var(--rule)', borderRadius: 6 }}
          type="button"
        >
          A+
        </button>
      </div>
      <div className="panel-label">Reading Mode</div>
      <div className="panel-row">
        <button
          className={`ibtn${ndOn ? ' nd-active' : ''}`}
          onClick={onToggleND}
          style={{ flex: 1, fontSize: 11, height: 34, border: '1px solid var(--rule)', borderRadius: 6 }}
          type="button"
          aria-pressed={ndOn}
        >
          Focus / ND
        </button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 14, lineHeight: 1.4, fontStyle: 'italic' }}>
        Bionic reading + sentence breaks
      </div>
      <div className="panel-label">Theme</div>
      <div className="panel-row">
        <button
          className="ibtn"
          onClick={() => setTheme('light')}
          style={{ flex: 1, height: 34, fontSize: 13, border: '1px solid var(--rule)', borderRadius: 6 }}
          type="button"
        >
          Light
        </button>
        <button
          className="ibtn"
          onClick={() => setTheme('dark')}
          style={{ flex: 1, height: 34, fontSize: 13, border: '1px solid var(--rule)', borderRadius: 6 }}
          type="button"
        >
          Dark
        </button>
      </div>
    </div>
  );
}
