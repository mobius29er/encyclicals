'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { storageGet, storageSet } from '@/lib/storage';
import type { DocumentBlock } from '@/types/document';

interface TTSBarProps {
  blocks: DocumentBlock[];
  isOpen: boolean;
  onClose: () => void;
  onActiveBlock: (id: string | null) => void;
}

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
  if (block.type === 'paragraph') return block.html.replace(/<[^>]+>/g, '').trim();
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

function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?]*[.!?]+[\u201d\u2019)]?\s*|[^.!?]+$/g);
  if (!parts) return [text];
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

function shortName(voice: SpeechSynthesisVoice | null): string {
  if (!voice) return 'Voice';
  const clean = voice.name.replace(/\s*\([^)]*\)\s*$/, '');
  return clean.length > 14 ? `${clean.slice(0, 12)}…` : clean;
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
    utterance.rate = speedRef.current;
    utterance.pitch = text.includes('“') || text.includes('"') ? 1.02 : 1;
    if (voiceRef.current) utterance.voice = voiceRef.current;
    utterance.onend = () => {
      if (playingRef.current && !pausedRef.current) {
        sentIRef.current += 1;
        window.setTimeout(speakNextSentence, 180);
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
      utterance.rate = speedRef.current * 0.9;
      utterance.pitch = 0.95;
      if (voiceRef.current) utterance.voice = voiceRef.current;
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
  }, [ttsStart]);

  const ttsNext = useCallback(() => {
    const synth = synthRef.current;
    if (synth) synth.cancel();
    pausedRef.current = false;
    sentQRef.current = [];
    sentIRef.current = 0;
    idxRef.current = Math.min(idxRef.current + 1, blocks.length - 1);
    speakItem();
  }, [blocks.length]);

  const ttsPrev = useCallback(() => {
    const synth = synthRef.current;
    if (synth) synth.cancel();
    pausedRef.current = false;
    sentQRef.current = [];
    sentIRef.current = 0;
    idxRef.current = Math.max(idxRef.current - 1, 0);
    speakItem();
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
  }, [speeds]);

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
  }, [blocks, loadVoices, onActiveBlock, ttsStart]);

  if (!isOpen) return null;

  return (
    <div className="tts-bar open">
      <div className="tts-prog" style={{ width: `${progress}%` }} />
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
            {voices.map((voice) => (
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
                {voice.name}{' '}
                <span style={{ fontSize: 10, color: 'var(--ink3)' }}>{voice.lang}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <button className="tts-speed" onClick={cycleSpeed} type="button">
        {speedLabels[speeds.indexOf(speed)] || '1×'}
      </button>
    </div>
  );
}
