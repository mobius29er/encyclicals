'use client';

/**
 * TTSBar - Text-to-Speech playback bar
 *
 * Engine priority (auto-detected, user-overridable):
 *   1. prerecorded — fetches /audio/<slug>/<block-id>.opus, instant on any device
 *   2. kokoro      — live Kokoro WASM inference (Apache 2.0), am_onyx voice
 *   3. browser     — Web Speech API system voices, always available
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { storageGet, storageSet } from '@/lib/storage';
import type { DocumentBlock } from '@/types/document';

interface TTSBarProps {
  blocks: DocumentBlock[];
  slug: string;
  isOpen: boolean;
  onClose: () => void;
  onActiveBlock: (id: string | null) => void;
}

type Engine   = 'detecting' | 'prerecorded' | 'loading' | 'kokoro' | 'browser';
type TtsStyle = 'original' | 'balanced' | 'expressive' | 'dramatic';

interface RawAudio { audio: Float32Array; sampling_rate: number }
interface KokoroEngine {
  generate(text: string, opts: { voice: string; speed: number }): Promise<RawAudio>;
}

const KOKORO_VOICES = [
  { id: 'am_onyx',    label: 'Onyx',    tag: '\u2642 American' },
  { id: 'am_santa',   label: 'Santa',   tag: '\u2642 American' },
  { id: 'am_puck',    label: 'Puck',    tag: '\u2642 American' },
  { id: 'am_echo',    label: 'Echo',    tag: '\u2642 American' },
  { id: 'am_michael', label: 'Michael', tag: '\u2642 American' },
  { id: 'bm_george',  label: 'George',  tag: '\u2642 British'  },
  { id: 'bm_lewis',   label: 'Lewis',   tag: '\u2642 British'  },
  { id: 'af_heart',   label: 'Heart',   tag: '\u2640 American' },
  { id: 'af_bella',   label: 'Bella',   tag: '\u2640 American' },
  { id: 'af_nova',    label: 'Nova',    tag: '\u2640 American' },
] as const;
type KokoroVoiceId = typeof KOKORO_VOICES[number]['id'];
const DEFAULT_KOKORO_VOICE: KokoroVoiceId = 'am_onyx';

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

const KOKORO_STYLE_PAUSE: Record<TtsStyle, number> = {
  original: 80, balanced: 120, expressive: 160, dramatic: 250,
};

let _ko: KokoroEngine | null = null;
let _koPending: Promise<KokoroEngine | null> | null = null;

async function initKokoro(onPct: (n: number) => void): Promise<KokoroEngine | null> {
  if (_ko) return _ko;
  if (_koPending) return _koPending;
  _koPending = (async () => {
    try {
      const { KokoroTTS } = await import('kokoro-js');
      const model = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (info: { status: string; progress?: number }) => {
          if (info.status === 'progress') onPct(Math.round(info.progress ?? 0));
        },
      });
      _ko = model as unknown as KokoroEngine;
      return _ko;
    } catch {
      _koPending = null;
      return null;
    }
  })();
  return _koPending;
}

const sleep = (ms: number): Promise<void> => new Promise(r => window.setTimeout(r, ms));

/** Play a decoded AudioBuffer at a given speed. Pause/resume via ctx.suspend/resume. */
function playBuffer(
  ctx: AudioContext,
  buffer: AudioBuffer,
  srcRef: React.MutableRefObject<AudioBufferSourceNode | null>,
  speed: number,
): Promise<void> {
  return new Promise(resolve => {
    try {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = speed;
      src.connect(ctx.destination);
      src.onended = () => { srcRef.current = null; resolve(); };
      src.start(0);
      srcRef.current = src;
    } catch {
      resolve();
    }
  });
}

/** Play raw Float32 audio from Kokoro. */
function playRaw(
  ctx: AudioContext,
  raw: RawAudio,
  srcRef: React.MutableRefObject<AudioBufferSourceNode | null>,
): Promise<void> {
  return new Promise(resolve => {
    try {
      const buf = ctx.createBuffer(1, raw.audio.length, raw.sampling_rate);
      buf.getChannelData(0).set(raw.audio);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.onended = () => { srcRef.current = null; resolve(); };
      src.start(0);
      srcRef.current = src;
    } catch {
      resolve();
    }
  });
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

function badgeForVoice(v: SpeechSynthesisVoice): string | null {
  const s = scoreVoice(v);
  if (s >= 300) return 'Premium';
  if (s >= 280) return 'Enhanced';
  if (s >= 250) return 'Good';
  return null;
}

function shortBrowserName(v: SpeechSynthesisVoice | null): string {
  if (!v) return 'Voice';
  const c = v.name.replace(/\s*\([^)]*\)\s*$/, '');
  return c.length > 14 ? `${c.slice(0, 12)}\u2026` : c;
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
  if (block.type === 'paragraph') return `\u00a7${block.number}`;
  if (block.type === 'chapter-header') return block.title;
  if (block.type === 'sec-head' || block.type === 'sub-head' || block.type === 'signature') {
    return block.html.replace(/<[^>]+>/g, '').trim().slice(0, 60);
  }
  return 'Reading\u2026';
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
  const merged = parts
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .reduce<string[]>((acc, part) => {
      if (!acc.length) { acc.push(part); return acc; }
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
  if (profile.rateJitter === 0) {
    return { rate: baseRate, pitch: 1.0, volume: profile.volumeBase, pauseMs: 180 };
  }
  const h = hashText(text);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const endsQuestion   = /\?\s*[\u201d\u2019)]?$/.test(text);
  const endsExclaim    = /!\s*[\u201d\u2019)]?$/.test(text);
  const hasCommaClause = /[,;:]/.test(text);
  const rateNoise  = ((h          % 1000) / 1000 - 0.5) * 2 * profile.rateJitter;
  const pitchNoise = (((h >>>  8) % 1000) / 1000 - 0.5) * 2 * profile.pitchJitter;
  const volNoise   = (((h >>> 16) % 1000) / 1000 - 0.5) * 2 * profile.volumeJitter;
  let rate    = baseRate + rateNoise;
  let pitch   = 1.0      + pitchNoise;
  const volume  = profile.volumeBase + volNoise;
  let pauseMs = 170 * profile.pauseMultiplier;
  if (words >= 25)     { rate -= 0.04; }
  if (hasCommaClause)  { rate -= 0.03; pauseMs += 40 * profile.pauseMultiplier; }
  if (endsQuestion)    { pitch += 0.03; pauseMs += 20 * profile.pauseMultiplier; }
  if (endsExclaim)     { pitch += 0.02; rate += 0.01; pauseMs += 10 * profile.pauseMultiplier; }
  if (sentIdx === 0)   { rate -= 0.02; }
  return {
    rate:    clamp(rate,    0.75, 1.45),
    pitch:   clamp(pitch,   0.96, 1.07),
    volume:  clamp(volume,  0.74, 0.82),
    pauseMs: clamp(pauseMs, 130,  380),
  };
}

// ─── component ───────────────────────────────────────────────────────────────

export default function TTSBar({ blocks, slug, isOpen, onClose, onActiveBlock }: TTSBarProps) {

  const [engine,  setEngine]  = useState<Engine>('detecting');
  const engineRef = useRef<Engine>('detecting');
  const [loadPct, setLoadPct] = useState(0);

  const [kokoroVoice, setKokoroVoice] = useState<string>(
    () => storageGet('kokoroVoice') || DEFAULT_KOKORO_VOICE,
  );
  const kokoroVoiceRef = useRef<string>(storageGet('kokoroVoice') || DEFAULT_KOKORO_VOICE);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSrcRef = useRef<AudioBufferSourceNode | null>(null);

  const synthRef  = useRef<SpeechSynthesis | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<SpeechSynthesisVoice | null>(null);
  const voiceRef  = useRef<SpeechSynthesisVoice | null>(null);
  const sentQRef  = useRef<string[]>([]);
  const sentIRef  = useRef(0);

  const [playing,  setPlaying]  = useState(false);
  const [paused,   setPaused]   = useState(false);
  const [speed,    setSpeed]    = useState(1);
  const [info,     setInfo]     = useState('');
  const [progress, setProgress] = useState(0);
  const [voiceMenuOpen, setVoiceMenuOpen] = useState(false);

  const idxRef      = useRef(-1);
  const playingRef  = useRef(false);
  const pausedRef   = useRef(false);
  const speedRef    = useRef(1);
  const sessionRef  = useRef(0);

  const [style, setStyle] = useState<TtsStyle>(() => {
    const saved = storageGet('ttsStyle') as TtsStyle;
    return STYLE_ORDER.includes(saved) ? saved : 'balanced';
  });
  const styleRef = useRef<TtsStyle>('balanced');

  // ── helpers ────────────────────────────────────────────────────────────────

  const makeAudioCtx = () => {
    const W = window as unknown as Record<string, typeof AudioContext>;
    const Ctor = window.AudioContext || W.webkitAudioContext;
    return new Ctor();
  };

  const stopAudio = () => {
    if (audioSrcRef.current) {
      try { audioSrcRef.current.stop(); } catch { /* already stopped */ }
      audioSrcRef.current = null;
    }
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch { /* already closed */ }
      audioCtxRef.current = null;
    }
  };

  const newSession = () => {
    stopAudio();
    const s = sessionRef.current + 1;
    sessionRef.current = s;
    playingRef.current = true;
    pausedRef.current  = false;
    setPlaying(true);
    setPaused(false);
    return s;
  };

  // ── browser (Web Speech API) helpers ──────────────────────────────────────

  const loadVoices = useCallback(() => {
    const synth = synthRef.current;
    if (!synth) return;
    const all = synth.getVoices();
    if (!all.length) return;
    const sorted = all.slice().sort((a, b) => scoreVoice(b) - scoreVoice(a));
    setVoices(sorted);
    const storedName = storageGet('ttsVoice');
    const picked = voiceRef.current ?? sorted.find(v => v.name === storedName) ?? sorted[0];
    voiceRef.current = picked;
    setSelectedVoice(picked);
  }, []);

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
    utterance.rate   = prosody.rate;
    utterance.pitch  = prosody.pitch;
    utterance.volume = prosody.volume;
    if (voiceRef.current) utterance.voice = voiceRef.current;
    utterance.lang = voiceRef.current?.lang || 'en-US';
    utterance.onend = () => {
      if (playingRef.current && !pausedRef.current) {
        sentIRef.current += 1;
        window.setTimeout(speakNextSentence, prosody.pauseMs);
      }
    };
    utterance.onerror = (ev) => {
      if (ev.error !== 'canceled') {
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
    if (idx < 0 || idx >= blocks.length) { ttsStopFn(); return; }
    const block = blocks[idx];
    const text = getReadText(block);
    if (!text || text.length < 2) { idxRef.current += 1; window.setTimeout(speakItem, 0); return; }
    onActiveBlock(block.id);
    setInfo(getTTSLabel(block));
    setProgress(((idx + 1) / blocks.length) * 100);
    const el = document.getElementById(block.id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    synth.cancel();
    if (block.type !== 'paragraph') {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate   = clamp(speedRef.current * 0.9, 0.75, 1.25);
      utterance.pitch  = 0.95;
      utterance.volume = clamp(STYLE_PROFILES[styleRef.current].volumeBase + 0.03, 0.60, 0.84);
      if (voiceRef.current) utterance.voice = voiceRef.current;
      utterance.lang = voiceRef.current?.lang || 'en-US';
      utterance.onend  = () => { if (playingRef.current && !pausedRef.current) { idxRef.current += 1; window.setTimeout(speakItem, 600); } };
      utterance.onerror = (ev) => { if (ev.error !== 'canceled' && playingRef.current) { idxRef.current += 1; window.setTimeout(speakItem, 200); } };
      synth.speak(utterance);
    } else {
      sentQRef.current = splitSentences(text);
      sentIRef.current = 0;
      speakNextSentence();
    }
    setPlaying(true);
    setPaused(false);
    playingRef.current = true;
    pausedRef.current  = false;
  }

  // ── prerecorded loop ───────────────────────────────────────────────────────

  async function prerecordedLoop(startIdx: number, session: number) {
    const ctx = makeAudioCtx();
    audioCtxRef.current = ctx;

    const fetchBlock = async (block: DocumentBlock): Promise<AudioBuffer | null> => {
      try {
        const resp = await fetch(`/audio/${slug}/${block.id}.opus`);
        if (!resp.ok) return null;
        const ab = await resp.arrayBuffer();
        return await ctx.decodeAudioData(ab);
      } catch { return null; }
    };

    // Find first valid block
    let idx = startIdx;
    while (idx < blocks.length && getReadText(blocks[idx]).length < 2) idx++;
    if (idx >= blocks.length) return;

    // Pre-fetch first block
    let nextPromise: Promise<AudioBuffer | null> = fetchBlock(blocks[idx]);

    while (idx < blocks.length && playingRef.current && sessionRef.current === session) {
      const block = blocks[idx];
      idxRef.current = idx;

      const audioBuffer = await nextPromise;

      // Advance to next valid block and pre-fetch while current plays
      let nextIdx = idx + 1;
      while (nextIdx < blocks.length && getReadText(blocks[nextIdx]).length < 2) nextIdx++;
      nextPromise = nextIdx < blocks.length ? fetchBlock(blocks[nextIdx]) : Promise.resolve(null);

      if (!playingRef.current || sessionRef.current !== session) return;

      const text = getReadText(block);
      if (!text || text.length < 2 || !audioBuffer) { idx = nextIdx; continue; }

      onActiveBlock(block.id);
      setInfo(getTTSLabel(block));
      setProgress(((idx + 1) / blocks.length) * 100);
      const el = document.getElementById(block.id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });

      await playBuffer(ctx, audioBuffer, audioSrcRef, speedRef.current);

      idx = nextIdx;
      if (playingRef.current && sessionRef.current === session && idx < blocks.length) {
        await sleep(200);
      }
    }
    if (sessionRef.current === session && playingRef.current) ttsStopFn();
  }

  // ── kokoro loop ────────────────────────────────────────────────────────────

  async function kokoroLoop(startIdx: number, session: number) {
    const tts = _ko;
    if (!tts) return;
    const ctx = makeAudioCtx();
    audioCtxRef.current = ctx;
    let idx = startIdx;
    while (idx < blocks.length && playingRef.current && sessionRef.current === session) {
      const block = blocks[idx];
      idxRef.current = idx;
      const text = getReadText(block);
      if (!text || text.length < 2) { idx++; continue; }
      onActiveBlock(block.id);
      setInfo(getTTSLabel(block));
      setProgress(((idx + 1) / blocks.length) * 100);
      const el = document.getElementById(block.id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const sentences = splitSentences(text);
      type GenResult = RawAudio | null;
      let nextPromise: Promise<GenResult> = sentences.length > 0
        ? tts.generate(sentences[0], { voice: kokoroVoiceRef.current, speed: speedRef.current })
            .then(r => r as GenResult).catch(() => null as GenResult)
        : Promise.resolve(null);
      for (let si = 0; si < sentences.length; si++) {
        if (!playingRef.current || sessionRef.current !== session) return;
        const rawAudio = await nextPromise;
        if (si + 1 < sentences.length) {
          const nextText = sentences[si + 1];
          const voiceSnap = kokoroVoiceRef.current;
          const speedSnap = speedRef.current;
          nextPromise = tts.generate(nextText, { voice: voiceSnap, speed: speedSnap })
            .then(r => r as GenResult).catch(() => null as GenResult);
        } else {
          nextPromise = Promise.resolve(null);
        }
        if (!rawAudio) continue;
        if (!playingRef.current || sessionRef.current !== session) return;
        await playRaw(ctx, rawAudio, audioSrcRef);
        if (si < sentences.length - 1 && playingRef.current && sessionRef.current === session && ctx.state === 'running') {
          await sleep(KOKORO_STYLE_PAUSE[styleRef.current]);
        }
      }
      idx++;
      if (playingRef.current && sessionRef.current === session && idx < blocks.length && ctx.state === 'running') {
        await sleep(200);
      }
    }
    if (sessionRef.current === session && playingRef.current) ttsStopFn();
  }

  // ── stop ──────────────────────────────────────────────────────────────────

  const ttsStopFn = useCallback(() => {
    stopAudio();
    if (synthRef.current) synthRef.current.cancel();
    playingRef.current = false;
    pausedRef.current  = false;
    idxRef.current     = -1;
    sentQRef.current   = [];
    sentIRef.current   = 0;
    setPlaying(false);
    setPaused(false);
    setInfo('');
    setProgress(0);
    onActiveBlock(null);
    onClose();
  }, [onActiveBlock, onClose]);

  // ── playback control ──────────────────────────────────────────────────────

  const findStartIdx = useCallback(() => {
    const sy = window.scrollY + window.innerHeight / 3;
    let near = 0;
    blocks.forEach((block, i) => {
      const el = document.getElementById(block.id);
      if (el && el.offsetTop <= sy && getReadText(block).length > 1) near = i;
    });
    return near;
  }, [blocks]);

  const playFromIdx = useCallback((idx: number) => {
    const eng = engineRef.current;
    if (eng === 'detecting' || eng === 'loading') return;
    if (synthRef.current) synthRef.current.cancel();
    const session = newSession();
    idxRef.current = idx;
    if (eng === 'prerecorded') {
      prerecordedLoop(idx, session);
    } else if (eng === 'kokoro') {
      kokoroLoop(idx, session);
    } else {
      // browser
      pausedRef.current = false;
      sentQRef.current  = [];
      sentIRef.current  = 0;
      speakItem();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, slug]);

  const ttsStart = useCallback(() => {
    if (engineRef.current === 'detecting' || engineRef.current === 'loading') return;
    playFromIdx(findStartIdx());
  }, [findStartIdx, playFromIdx]);

  const ttsToggle = useCallback(() => {
    const eng = engineRef.current;
    if (eng === 'detecting' || eng === 'loading') return;
    if (eng === 'prerecorded' || eng === 'kokoro') {
      if (!playingRef.current) { ttsStart(); return; }
      if (pausedRef.current) {
        audioCtxRef.current?.resume();
        pausedRef.current = false;
        setPaused(false);
        setPlaying(true);
      } else {
        audioCtxRef.current?.suspend();
        pausedRef.current = true;
        setPaused(true);
      }
      return;
    }
    const synth = synthRef.current;
    if (!synth) return;
    if (!playingRef.current) {
      if (pausedRef.current) {
        synth.resume();
        pausedRef.current  = false;
        playingRef.current = true;
        setPaused(false);
        setPlaying(true);
      } else {
        ttsStart();
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
    playFromIdx(Math.min(idxRef.current + 1, blocks.length - 1));
  }, [blocks.length, playFromIdx]);

  const ttsPrev = useCallback(() => {
    playFromIdx(Math.max(idxRef.current - 1, 0));
  }, [playFromIdx]);

  const speeds      = [0.8, 1, 1.15, 1.3, 1.5, 1.8];
  const speedLabels = ['0.8\u00d7', '1\u00d7', '1.15\u00d7', '1.3\u00d7', '1.5\u00d7', '1.8\u00d7'];

  const cycleSpeed = useCallback(() => {
    const next = speeds[(speeds.indexOf(speedRef.current) + 1) % speeds.length];
    speedRef.current = next;
    setSpeed(next);
    if (playingRef.current && !pausedRef.current && engineRef.current === 'browser' && synthRef.current) {
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

  /** Switch engine mid-session: stop current, start new engine from same position */
  const switchEngine = useCallback((target: Engine) => {
    stopAudio();
    if (synthRef.current) synthRef.current.cancel();
    playingRef.current = false;
    pausedRef.current  = false;
    setPlaying(false);
    setPaused(false);
    engineRef.current = target;
    setEngine(target);
    storageSet('ttsEngine', target);
    setVoiceMenuOpen(false);
    const resumeIdx = Math.max(idxRef.current, 0);
    window.setTimeout(() => {
      const session = newSession();
      idxRef.current = resumeIdx;
      if (target === 'prerecorded') {
        prerecordedLoop(resumeIdx, session);
      } else if (target === 'kokoro') {
        if (_ko) {
          kokoroLoop(resumeIdx, session);
        } else {
          engineRef.current = 'loading';
          setEngine('loading');
          initKokoro(pct => setLoadPct(pct)).then(model => {
            if (model) {
              engineRef.current = 'kokoro';
              window.setTimeout(() => { setEngine('kokoro'); setInfo(''); }, 0);
              kokoroLoop(resumeIdx, session);
            } else {
              engineRef.current = 'browser';
              window.setTimeout(() => setEngine('browser'), 0);
              speakItem();
            }
          });
        }
      } else {
        speakItem();
      }
    }, 50);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, slug]);

  // ── mount effect ──────────────────────────────────────────────────────────

  useEffect(() => {
    document.body.classList.add('tts-on');
    synthRef.current = window.speechSynthesis || null;
    let voiceTimers: number[] = [];
    let keepAlive = 0;
    let prevVoicesChanged: typeof speechSynthesis.onvoiceschanged = null;
    if (synthRef.current) {
      loadVoices();
      voiceTimers = [100, 250, 500, 1000, 2000, 4000].map(d => window.setTimeout(loadVoices, d));
      prevVoicesChanged = speechSynthesis.onvoiceschanged;
      speechSynthesis.onvoiceschanged = () => loadVoices();
      keepAlive = window.setInterval(() => {
        if (synthRef.current && playingRef.current && !pausedRef.current && synthRef.current.speaking) {
          synthRef.current.pause();
          synthRef.current.resume();
        }
      }, 10000);
    }
    const handleClick = (ev: MouseEvent) => {
      if (!(ev.target as HTMLElement).closest('.tts-vwrap')) setVoiceMenuOpen(false);
    };
    const handleDblClick = (ev: MouseEvent) => {
      const card = (ev.target as HTMLElement).closest('.card') as HTMLElement | null;
      if (!card) return;
      const idx = blocks.findIndex(b => b.id === card.id);
      if (idx > -1) playFromIdx(idx);
    };
    document.addEventListener('click', handleClick);
    document.addEventListener('dblclick', handleDblClick);

    let cancelled = false;
    let startTimer = 0;

    const cleanup = () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      voiceTimers.forEach(t => window.clearTimeout(t));
      window.clearInterval(keepAlive);
      document.body.classList.remove('tts-on');
      document.removeEventListener('click', handleClick);
      document.removeEventListener('dblclick', handleDblClick);
      speechSynthesis.onvoiceschanged = prevVoicesChanged;
      stopAudio();
      if (synthRef.current) synthRef.current.cancel();
      playingRef.current = false;
      onActiveBlock(null);
    };

    const savedEngine = storageGet('ttsEngine') as Engine | null;

    // Probe for pre-recorded audio
    const probeUrl = `/audio/${slug}/p1.opus`;
    fetch(probeUrl, { method: 'HEAD' }).then(r => {
      if (cancelled) return;
      if (r.ok && savedEngine !== 'kokoro' && savedEngine !== 'browser') {
        // Pre-recorded available and user hasn't overridden
        engineRef.current = 'prerecorded';
        window.setTimeout(() => { if (!cancelled) { setEngine('prerecorded'); setInfo(''); } }, 0);
        startTimer = window.setTimeout(() => { if (!cancelled) ttsStart(); }, 80);
      } else if (savedEngine === 'kokoro' || !r.ok) {
        // Try Kokoro
        engineRef.current = 'loading';
        window.setTimeout(() => { if (!cancelled) { setEngine('loading'); setInfo('Loading voice\u2026'); } }, 0);
        if (_ko) {
          engineRef.current = 'kokoro';
          window.setTimeout(() => { if (!cancelled) { setEngine('kokoro'); setInfo(''); } }, 0);
          startTimer = window.setTimeout(() => { if (!cancelled) ttsStart(); }, 50);
        } else {
          initKokoro(pct => { if (!cancelled) setLoadPct(pct); }).then(model => {
            if (cancelled) return;
            if (model) {
              engineRef.current = 'kokoro';
              window.setTimeout(() => { if (!cancelled) { setEngine('kokoro'); setInfo(''); } }, 0);
            } else {
              engineRef.current = 'browser';
              window.setTimeout(() => { if (!cancelled) setEngine('browser'); }, 0);
            }
            startTimer = window.setTimeout(() => { if (!cancelled) ttsStart(); }, 100);
          });
        }
      } else {
        // savedEngine === 'browser'
        engineRef.current = 'browser';
        window.setTimeout(() => { if (!cancelled) setEngine('browser'); }, 0);
        startTimer = window.setTimeout(() => { if (!cancelled) ttsStart(); }, 80);
      }
    }).catch(() => {
      if (cancelled) return;
      // No pre-recorded, fall to Kokoro
      engineRef.current = 'loading';
      window.setTimeout(() => { if (!cancelled) { setEngine('loading'); setInfo('Loading voice\u2026'); } }, 0);
      initKokoro(pct => { if (!cancelled) setLoadPct(pct); }).then(model => {
        if (cancelled) return;
        engineRef.current = model ? 'kokoro' : 'browser';
        window.setTimeout(() => { if (!cancelled) setEngine(model ? 'kokoro' : 'browser'); }, 0);
        startTimer = window.setTimeout(() => { if (!cancelled) ttsStart(); }, 100);
      });
    });

    return cleanup;
  }, [blocks, slug, loadVoices, onActiveBlock, ttsStart, playFromIdx]);

  if (!isOpen) return null;

  // ── render ────────────────────────────────────────────────────────────────

  const infoText = engine === 'detecting'
    ? 'Starting\u2026'
    : engine === 'loading'
      ? `Loading\u2026${loadPct > 0 ? ` ${loadPct}%` : ''}`
      : info;

  const voiceLabel = engine === 'prerecorded'
    ? 'Onyx'
    : engine === 'browser'
      ? shortBrowserName(selectedVoice)
      : (KOKORO_VOICES.find(v => v.id === kokoroVoice)?.label ?? 'Onyx');

  const voiceBadge = engine === 'prerecorded'
    ? 'Pre-rec'
    : engine === 'kokoro'
      ? 'Neural'
      : engine === 'loading' || engine === 'detecting'
        ? '\u2026'
        : (badgeForVoice(selectedVoice!) ?? selectedVoice?.lang ?? '');

  return (
    <div className="tts-bar open">
      <div className="tts-prog" style={{ '--tts-w': `${progress}%` } as React.CSSProperties} />
      <button className="tts-btn" onClick={ttsPrev} type="button">{'\u23ee'}</button>
      <button className={`tts-btn${playing && !paused ? ' active' : ''}`} onClick={ttsToggle} type="button">
        {playing && !paused ? '\u23f8' : '\u25b6'}
      </button>
      <button className="tts-btn" onClick={ttsNext} type="button">{'\u23ed'}</button>
      <button className="tts-btn" onClick={ttsStopFn} type="button">{'\u25a0'}</button>
      <span className="tts-info">{infoText}</span>
      <button className="tts-speed" onClick={cycleSpeed} type="button">
        {speedLabels[speeds.indexOf(speed)] ?? '1\u00d7'}
      </button>
      <button className="tts-style" onClick={cycleStyle} type="button">
        {STYLE_PROFILES[style].label}
      </button>
      <div className="tts-vwrap">
        <button className="tts-vbtn" type="button" onClick={() => setVoiceMenuOpen(o => !o)}>
          {voiceLabel}
          <span className="tts-vbadge">{voiceBadge}</span>
        </button>
        {voiceMenuOpen && (
          <div className="tts-vmenu">
            <div className="tts-vmode-hdr">PLAYBACK MODE</div>
            <button
              className={`tts-vopt tts-vmode${engine === 'prerecorded' ? ' sel' : ''}`}
              type="button"
              onClick={() => switchEngine('prerecorded')}
            >
              <span>Pre-recorded</span>
              <span className="tts-vbadge">Instant</span>
            </button>
            <button
              className={`tts-vopt tts-vmode${engine === 'kokoro' || engine === 'loading' ? ' sel' : ''}`}
              type="button"
              onClick={() => switchEngine('kokoro')}
            >
              <span>Neural (Kokoro)</span>
              <span className="tts-vbadge">Live</span>
            </button>
            <button
              className={`tts-vopt tts-vmode${engine === 'browser' ? ' sel' : ''}`}
              type="button"
              onClick={() => switchEngine('browser')}
            >
              <span>Browser</span>
              <span className="tts-vbadge">System</span>
            </button>

            {(engine === 'kokoro' || engine === 'loading') && (
              <>
                <div className="tts-vlang tts-vlang-en">KOKORO VOICES</div>
                {KOKORO_VOICES.map(v => (
                  <button
                    key={v.id}
                    className={`tts-vopt${kokoroVoice === v.id ? ' sel' : ''}`}
                    type="button"
                    onClick={() => {
                      kokoroVoiceRef.current = v.id;
                      setKokoroVoice(v.id);
                      setVoiceMenuOpen(false);
                      storageSet('kokoroVoice', v.id);
                    }}
                  >
                    <span>{v.label}{' '}<span className="tts-vlang-code">{v.tag}</span></span>
                  </button>
                ))}
              </>
            )}

            {engine === 'browser' && voices.map(voice => {
              const badge = badgeForVoice(voice);
              return (
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
            })}
          </div>
        )}
      </div>
    </div>
  );
}
