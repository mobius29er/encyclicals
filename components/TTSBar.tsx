'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { storageGet, storageSet } from '@/lib/storage';
import type { DocumentBlock } from '@/types/document';

interface TTSBarProps {
  blocks: DocumentBlock[];
  isOpen: boolean;
  onClose: () => void;
  onActiveBlock: (id: string | null) => void;
}

type TtsStyle = 'original' | 'balanced' | 'expressive' | 'dramatic';

const STYLE_ORDER: TtsStyle[] = ['original', 'balanced', 'expressive', 'dramatic'];

interface StyleProfile {
  label: string;
  rateJitter: number;
  pitchJitter: number;
  volumeBase: number;
  volumeJitter: number;
  pauseMultiplier: number;
}

const STYLE_PROFILES: Record<TtsStyle, StyleProfile> = {
  original:   { label: 'Original',   rateJitter: 0,    pitchJitter: 0,     volumeBase: 0.78, volumeJitter: 0,    pauseMultiplier: 1.0  },
  balanced:   { label: 'Balanced',   rateJitter: 0.02, pitchJitter: 0.01,  volumeBase: 0.78, volumeJitter: 0.01, pauseMultiplier: 1.15 },
  expressive: { label: 'Expressive', rateJitter: 0.03, pitchJitter: 0.015, volumeBase: 0.78, volumeJitter: 0.02, pauseMultiplier: 1.25 },
  dramatic:   { label: 'Dramatic',   rateJitter: 0.05, pitchJitter: 0.02,  volumeBase: 0.78, volumeJitter: 0.03, pauseMultiplier: 1.4  },
};

function scoreVoice(v: SpeechSynthesisVoice): number {
  let s = 0;
  const n = v.name.toLowerCase();
  const l = v.lang.toLowerCase();
  if (l.startsWith('en')) s += 200;
  if (n.includes('premium')) s += 100;
  if (n.includes('enhanced')) s += 90;
  if (n.includes('natural')) s += 85;
  if (n.includes('neural')) s += 80;
  if (n.includes('siri')) s += 70;
  if (n.includes('google')) s += 50;
  if (n.includes('microsoft') && n.includes('online')) s += 60;
  if (!v.localService) s += 20;
  return s;
}

function getReadText(block: DocumentBlock): string {
  if (block.type === 'paragraph') {
    return block.html
      .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '')
      .replace(/<[^>]+>/g, '')
      .trim();
  }
  if (block.type === 'chapter-header') return block.title;
  if (block.type === 'sec-head' || block.type === 'sub-head' || block.type === 'signature') {
    return block.html.replace(/<[^>]+>/g, '').trim();
  }
  return '';
}

function getTTSLabel(block: DocumentBlock): string {
  if (block.type === 'paragraph') return `§${block.number}`;
  if (block.type === 'chapter-header') return block.title;
  if (block.type === 'sec-head' || block.type === 'sub-head' || block.type === 'signature') {
    return block.html.replace(/<[^>]+>/g, '').trim().slice(0, 60);
  }
  return 'Reading…';
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function normalizeForSpeech(text: string): string {
  return text
    .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\(cf\.[^)]{0,80}\)/gi, '')
    .replace(/\(see [A-Z][^)]{0,60}\)/g, '')
    // orphaned footnote/page number clusters e.g. "301. 223 82" or "139-141. 61"
    .replace(/\b\d{2,4}[.\-]\s*\d{2,4}[.\-]?\s*\d{0,3}\b/g, ' ')
    .replace(/\b\d{3,4}\.\s(?=[A-Z])/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[\u2014\u2013]/g, ', ')
    .replace(/\s+([,.;!?])/g, '$1')
    .trim();
}

function splitSentences(text: string): string[] {
  const normalized = normalizeForSpeech(text);
  const parts = normalized.match(/[^.!?]*[.!?]+[\u201d\u2019)]?\s*|[^.!?]+$/g);
  if (!parts) return [text];

  // Merge very short fragments with the previous sentence so the rhythm is less choppy.
  const merged = parts.map((s) => s.trim()).filter((s) => s.length > 0).reduce<string[]>((acc, part) => {
    if (!acc.length) {
      acc.push(part);
      return acc;
    }
    const isTooShort = part.length < 22;
    const isContinuation = /^[,;:\-)]/.test(part);
    if (isTooShort || isContinuation) {
      acc[acc.length - 1] = `${acc[acc.length - 1]} ${part}`;
    } else {
      acc.push(part);
    }
    return acc;
  }, []);

  return merged.length ? merged : [normalized];
}

function hashText(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function prosodyForSentence(
  text: string,
  baseRate: number,
  profile: StyleProfile,
  sentIdx: number,
): { rate: number; pitch: number; volume: number; pauseMs: number } {
  // Original: flat delivery, no prosody variation
  if (profile.rateJitter === 0) {
    return { rate: baseRate, pitch: 1.0, volume: profile.volumeBase, pauseMs: 180 };
  }

  const h = hashText(text);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const endsQuestion = /\?\s*[\u201d\u2019)]?$/.test(text);
  const endsExclaim = /!\s*[\u201d\u2019)]?$/.test(text);
  const hasCommaClause = /[,;:]/.test(text);

  // Deterministic per-sentence noise across three independent hash channels
  const rateNoise  = ((h          % 1000) / 1000 - 0.5) * 2 * profile.rateJitter;
  const pitchNoise = (((h >>>  8) % 1000) / 1000 - 0.5) * 2 * profile.pitchJitter;
  const volNoise   = (((h >>> 16) % 1000) / 1000 - 0.5) * 2 * profile.volumeJitter;

  let rate    = baseRate + rateNoise;
  let pitch   = 1.0      + pitchNoise;
  const volume  = profile.volumeBase + volNoise;
  let pauseMs = 170 * profile.pauseMultiplier;

  // Only gently slow very long sentences — no speedup on short ones
  if (words >= 25) rate -= 0.04;

  if (hasCommaClause) {
    rate    -= 0.03;
    pauseMs += 40 * profile.pauseMultiplier;
  }
  if (endsQuestion) {
    pitch   += 0.03;
    pauseMs += 20 * profile.pauseMultiplier;
  }
  if (endsExclaim) {
    pitch   += 0.02;
    rate    += 0.01;
    pauseMs += 10 * profile.pauseMultiplier;
  }
  // Opening sentence of each block: slightly deliberate pace
  if (sentIdx === 0) {
    rate -= 0.02;
  }

  return {
    rate:    clamp(rate,    0.75, 1.45),
    pitch:   clamp(pitch,   0.96, 1.07),
    volume:  clamp(volume,  0.74, 0.82),
    pauseMs: clamp(pauseMs, 130,  380),
  };
}

function shortName(voice: SpeechSynthesisVoice | null): string {
  if (!voice) return 'Voice';
  const clean = voice.name.replace(/\s*\([^)]*\)\s*$/, '');
  return clean.length > 14 ? `${clean.slice(0, 12)}…` : clean;
}

function badgeForVoice(voice: SpeechSynthesisVoice): string | null {
  const s = scoreVoice(voice);
  if (s >= 300) return 'Premium';
  if (s >= 280) return 'Enhanced';
  if (s >= 250) return 'Good';
  return null;
}

export default function TTSBar({ blocks, isOpen, onClose, onActiveBlock }: TTSBarProps) {
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [info, setInfo] = useState('Ready');
  const [progress, setProgress] = useState(0);
  const [voiceMenuOpen, setVoiceMenuOpen] = useState(false);
  const idxRef = useRef(-1);
  const playingRef = useRef(false);
  const pausedRef = useRef(false);
  const speedRef = useRef(1);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const sentQRef = useRef<string[]>([]);
  const sentIRef = useRef(0);
  const [style, setStyle] = useState<TtsStyle>(() => {
    const saved = storageGet('ttsStyle') as TtsStyle;
    return STYLE_ORDER.includes(saved) ? saved : 'balanced';
  });
  const styleRef = useRef<TtsStyle>(style);

  const loadVoices = useCallback(() => {
    const synth = synthRef.current;
    if (!synth) return;
    const all = synth.getVoices();
    if (!all.length) return;
    const sorted = all.slice().sort((a, b) => scoreVoice(b) - scoreVoice(a));
    setVoices(sorted);
    const storedName = storageGet('ttsVoice');
    const picked = voiceRef.current ?? sorted.find((voice) => voice.name === storedName) ?? sorted[0];
    voiceRef.current = picked;
    setSelectedVoice(picked);
  }, []);

  const ttsStopFn = useCallback(() => {
    const synth = synthRef.current;
    if (synth) synth.cancel();
    playingRef.current = false;
    pausedRef.current = false;
    idxRef.current = -1;
    sentQRef.current = [];
    sentIRef.current = 0;
    setPlaying(false);
    setPaused(false);
    setInfo('Stopped');
    setProgress(0);
    onActiveBlock(null);
    onClose();
  }, [onActiveBlock, onClose]);

  function speakNextSentence() {
    const synth = synthRef.current;
    if (!synth) return;
    if (sentIRef.current >= sentQRef.current.length) {
      if (playingRef.current && !pausedRef.current) {
        idxRef.current += 1;
        window.setTimeout(speakItem, 500);
      }
      return;
    }

    const text = sentQRef.current[sentIRef.current];
    const utterance = new SpeechSynthesisUtterance(text);
    const prosody = prosodyForSentence(text, speedRef.current, STYLE_PROFILES[styleRef.current], sentIRef.current);
    utterance.rate = prosody.rate;
    utterance.pitch = prosody.pitch;
    utterance.volume = prosody.volume;
    if (voiceRef.current) utterance.voice = voiceRef.current;
    utterance.lang = voiceRef.current?.lang || 'en-US';
    utterance.onend = () => {
      if (playingRef.current && !pausedRef.current) {
        sentIRef.current += 1;
        window.setTimeout(speakNextSentence, prosody.pauseMs);
      }
    };
    utterance.onerror = (event) => {
      if (event.error !== 'canceled') {
        sentIRef.current += 1;
        if (playingRef.current) window.setTimeout(speakNextSentence, 100);
      }
    };
    synth.speak(utterance);
  }

  function speakItem() {
    const synth = synthRef.current;
    if (!synth) return;
    const idx = idxRef.current;
    if (idx < 0 || idx >= blocks.length) {
      ttsStopFn();
      return;
    }
    const block = blocks[idx];
    const text = getReadText(block);
    if (!text || text.length < 2) {
      idxRef.current += 1;
      window.setTimeout(speakItem, 0);
      return;
    }

    onActiveBlock(block.id);
    setInfo(getTTSLabel(block));
    setProgress(((idx + 1) / blocks.length) * 100);
    const el = document.getElementById(block.id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    synth.cancel();
    const isHeader = block.type !== 'paragraph';
    if (isHeader) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = clamp(speedRef.current * 0.9, 0.75, 1.25);
      utterance.pitch = 0.95;
      utterance.volume = clamp(STYLE_PROFILES[styleRef.current].volumeBase + 0.03, 0.60, 0.84);
      if (voiceRef.current) utterance.voice = voiceRef.current;
      utterance.lang = voiceRef.current?.lang || 'en-US';
      utterance.onend = () => {
        if (playingRef.current && !pausedRef.current) {
          idxRef.current += 1;
          window.setTimeout(speakItem, 600);
        }
      };
      utterance.onerror = (event) => {
        if (event.error !== 'canceled' && playingRef.current) {
          idxRef.current += 1;
          window.setTimeout(speakItem, 200);
        }
      };
      synth.speak(utterance);
    } else {
      sentQRef.current = splitSentences(text);
      sentIRef.current = 0;
      speakNextSentence();
    }

    setPlaying(true);
    setPaused(false);
    playingRef.current = true;
    pausedRef.current = false;
  }

  const ttsStart = useCallback(() => {
    const synth = synthRef.current;
    if (!synth) {
      setInfo('TTS unavailable');
      return;
    }
    loadVoices();
    const sy = window.scrollY + window.innerHeight / 3;
    let near = 0;
    blocks.forEach((block, index) => {
      const el = document.getElementById(block.id);
      if (el && el.offsetTop <= sy && getReadText(block).length > 1) near = index;
    });
    idxRef.current = near;
    speakItem();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, loadVoices]);

  const ttsToggle = useCallback(() => {
    const synth = synthRef.current;
    if (!synth) return;
    if (!playingRef.current) {
      if (idxRef.current < 0) ttsStart();
      else if (pausedRef.current) {
        synth.resume();
        pausedRef.current = false;
        playingRef.current = true;
        setPaused(false);
        setPlaying(true);
      } else {
        speakItem();
      }
      return;
    }
    if (pausedRef.current) {
      synth.resume();
      pausedRef.current = false;
      setPaused(false);
      setPlaying(true);
    } else {
      synth.pause();
      pausedRef.current = true;
      setPaused(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsStart]);

  const ttsNext = useCallback(() => {
    const synth = synthRef.current;
    if (synth) synth.cancel();
    pausedRef.current = false;
    sentQRef.current = [];
    sentIRef.current = 0;
    idxRef.current = Math.min(idxRef.current + 1, blocks.length - 1);
    speakItem();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks.length]);

  const ttsPrev = useCallback(() => {
    const synth = synthRef.current;
    if (synth) synth.cancel();
    pausedRef.current = false;
    sentQRef.current = [];
    sentIRef.current = 0;
    idxRef.current = Math.max(idxRef.current - 1, 0);
    speakItem();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const speeds = [0.8, 1, 1.15, 1.3, 1.5, 1.8];
  const speedLabels = ['0.8×', '1×', '1.15×', '1.3×', '1.5×', '1.8×'];

  const cycleSpeed = useCallback(() => {
    const currentIndex = (speeds.indexOf(speedRef.current) + 1) % speeds.length;
    speedRef.current = speeds[currentIndex];
    setSpeed(speeds[currentIndex]);
    if (playingRef.current && !pausedRef.current && synthRef.current) {
      synthRef.current.cancel();
      speakItem();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speeds]);

  const cycleStyle = useCallback(() => {
    const next = STYLE_ORDER[(STYLE_ORDER.indexOf(styleRef.current) + 1) % STYLE_ORDER.length];
    styleRef.current = next;
    setStyle(next);
    storageSet('ttsStyle', next);
  }, []);

  useEffect(() => {
    synthRef.current = window.speechSynthesis || null;
    if (!synthRef.current) {
      setInfo('TTS unavailable');
      return undefined;
    }

    document.body.classList.add('tts-on');
    loadVoices();
    const timerIds = [100, 250, 500, 1000, 2000, 4000].map((delay) => window.setTimeout(loadVoices, delay));
    const keepAlive = window.setInterval(() => {
      if (synthRef.current && playingRef.current && !pausedRef.current && synthRef.current.speaking) {
        synthRef.current.pause();
        synthRef.current.resume();
      }
    }, 10000);

    const previousVoicesChanged = speechSynthesis.onvoiceschanged;
    speechSynthesis.onvoiceschanged = () => loadVoices();

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.tts-vwrap')) setVoiceMenuOpen(false);
    };

    const handleDoubleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const card = target.closest('.card') as HTMLElement | null;
      if (!card) return;
      const idx = blocks.findIndex((block) => block.id === card.id);
      if (idx > -1) {
        if (synthRef.current) synthRef.current.cancel();
        pausedRef.current = false;
        sentQRef.current = [];
        sentIRef.current = 0;
        idxRef.current = idx;
        speakItem();
      }
    };

    document.addEventListener('click', handleClick);
    document.addEventListener('dblclick', handleDoubleClick);
    const starter = window.setTimeout(() => ttsStart(), 50);

    return () => {
      window.clearTimeout(starter);
      timerIds.forEach((id) => window.clearTimeout(id));
      window.clearInterval(keepAlive);
      document.body.classList.remove('tts-on');
      document.removeEventListener('click', handleClick);
      document.removeEventListener('dblclick', handleDoubleClick);
      speechSynthesis.onvoiceschanged = previousVoicesChanged;
      if (synthRef.current) synthRef.current.cancel();
      onActiveBlock(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, loadVoices, onActiveBlock, ttsStart]);

  if (!isOpen) return null;

  const voiceMenuItems: React.ReactNode[] = [];
  {
    let lastLangGroup = '';
    voices.forEach((voice) => {
      const langBase = (voice.lang || '').split('-')[0];
      if (langBase !== lastLangGroup) {
        if (langBase === 'en') {
          voiceMenuItems.push(
            <div key="sep-en" className="tts-vlang tts-vlang-en">
              ENGLISH
            </div>
          );
        } else if (lastLangGroup === 'en' || lastLangGroup === '') {
          voiceMenuItems.push(
            <div key="sep-other" className="tts-vlang tts-vlang-other">
              OTHER LANGUAGES
            </div>
          );
        }
        lastLangGroup = langBase;
      }
      const badge = badgeForVoice(voice);
      voiceMenuItems.push(
        <button
          key={`${voice.name}-${voice.lang}`}
          className={`tts-vopt${selectedVoice?.name === voice.name ? ' sel' : ''}`}
          type="button"
          onClick={() => {
            voiceRef.current = voice;
            setSelectedVoice(voice);
            setVoiceMenuOpen(false);
            storageSet('ttsVoice', voice.name);
            if (playingRef.current && !pausedRef.current && synthRef.current) {
              synthRef.current.cancel();
              speakItem();
            }
          }}
        >
          <span>
            {voice.name.length > 32 ? `${voice.name.slice(0, 30)}\u2026` : voice.name}{' '}
            <span className="tts-vlang-code">{voice.lang}</span>
          </span>
          {badge && <span className="tts-vbadge">{badge}</span>}
        </button>
      );
    });
  }

  return (
    <div className="tts-bar open">
      <div className="tts-prog" style={{ '--tts-w': `${progress}%` } as React.CSSProperties} />
      <button className="tts-btn" onClick={ttsPrev} type="button">
        ⏮
      </button>
      <button className={`tts-btn${playing && !paused ? ' active' : ''}`} onClick={ttsToggle} type="button">
        {playing && !paused ? '⏸' : '▶'}
      </button>
      <button className="tts-btn" onClick={ttsNext} type="button">
        ⏭
      </button>
      <button className="tts-btn" onClick={ttsStopFn} type="button">
        ■
      </button>
      <div className="tts-info">{info}</div>
      <div className="tts-vwrap">
        <button className="tts-vbtn" onClick={() => { loadVoices(); setVoiceMenuOpen((v) => !v); }} type="button">
          {shortName(selectedVoice)}
        </button>
        {voiceMenuOpen && (
          <div className="tts-vmenu open">
            <div className="tts-vtip">
              💡 All voices on your device are shown below. iPhone: Settings → Accessibility → Spoken Content → Voices to download more. Personal Voice is not accessible to web apps (iOS limitation).
            </div>
            <button
              className="tts-vopt tts-vrefresh"
              type="button"
              onClick={() => { loadVoices(); }}
            >
              ↻ Refresh ({voices.length} voices found)
            </button>
            {voiceMenuItems}
            {!voices.length && (
              <div className="tts-vopt">No voices found. Tap Refresh after a moment.</div>
            )}
          </div>
        )}
      </div>
      <button className="tts-speed" onClick={cycleSpeed} type="button">
        {speedLabels[speeds.indexOf(speed)] || '1×'}
      </button>
      <button className="tts-style" onClick={cycleStyle} type="button" title={STYLE_PROFILES[style].label}>
        {STYLE_PROFILES[style].label}
      </button>
    </div>
  );
}
