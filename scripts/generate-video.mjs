/**
 * generate-video.mjs
 * Produces a YouTube-ready 1920×1080 MP4 for each document.
 *
 * Prerequisites:
 *   1. Run `node scripts/generate-tts-audio.mjs` first (generates opus files).
 *   2. ffmpeg ≥ 4.4 with libx264, libopus, libass in PATH.
 *
 * Usage:
 *   node scripts/generate-video.mjs
 *   node scripts/generate-video.mjs --slug magnifica-humanitas
 *
 * Output: public/video/<slug>.mp4
 *
 * Video specs:
 *   - 1920×1080, yuv420p, H.264 CRF 20, faststart (streaming-ready)
 *   - AAC 192 kbps stereo
 *   - Burned-in ASS subtitles: current paragraph text + chapter header
 *   - Total duration = sum of per-block audio durations
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');

// ── configuration ─────────────────────────────────────────────────────────

const FFMPEG  = process.env.FFMPEG  || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const VIDEO_W = 1920;
const VIDEO_H = 1080;

// Palette — matches the app's dark-reader theme
const BG       = '0d0905';   // near-black parchment
const GOLD     = 'c8a45a';   // heading gold
const CREAM    = 'e8dbbf';   // body text
const SUBTITLE = 'd4c5a0';   // paragraph text
const DIM      = '706050';   // secondary

// ── utilities ─────────────────────────────────────────────────────────────

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (result.error) throw result.error;
  return result;
}

/** Get duration in seconds via ffprobe. Returns 0 on failure. */
function getDuration(filePath) {
  const r = run(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  return parseFloat(r.stdout.trim()) || 0;
}

/** Strip HTML and footnotes from block text */
function getReadText(block) {
  if (block.type === 'paragraph') {
    return block.html
      .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (block.type === 'chapter-header') return block.title ?? '';
  if (['sec-head', 'sub-head', 'signature'].includes(block.type)) {
    return (block.html ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }
  return '';
}

/** Format seconds → SRT timestamp  HH:MM:SS,mmm */
function srtTime(s) {
  const ms   = Math.round((s % 1) * 1000);
  const secs = Math.floor(s) % 60;
  const mins = Math.floor(s / 60) % 60;
  const hrs  = Math.floor(s / 3600);
  return `${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
}

/** Wrap text into lines of ≤ maxChars. */
function wrapText(text, maxChars = 72) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (line.length + word.length + 1 > maxChars && line.length > 0) {
      lines.push(line);
      line = word;
    } else {
      line = line.length ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  // SRT max 2 lines; merge overflow
  return lines.slice(0, 3).join('\n');
}

/**
 * Build an ASS subtitle file.
 * - Chapter headers: large centred gold text with a short fade-in
 * - Section heads:   medium gold, centred
 * - Paragraphs:      cream, bottom-third
 */
function buildASS(timeline, docTitle, docAuthor) {
  const lines = [];

  lines.push('[Script Info]');
  lines.push(`Title: ${docTitle}`);
  lines.push('ScriptType: v4.00+');
  lines.push('WrapStyle: 2');           // smart wrapping
  lines.push(`PlayResX: ${VIDEO_W}`);
  lines.push(`PlayResY: ${VIDEO_H}`);
  lines.push('Collisions: Normal');
  lines.push('');

  lines.push('[V4+ Styles]');
  lines.push('Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding');

  // ASS colour is &HAABBGGRR
  const assColor = (hex) => {
    const r = hex.slice(0,2); const g = hex.slice(2,4); const b = hex.slice(4,6);
    return `&H00${b}${g}${r}`;
  };
  const assAlpha = (hex, a) => {
    const r = hex.slice(0,2); const g = hex.slice(2,4); const b = hex.slice(4,6);
    const aa = Math.round(a * 255).toString(16).padStart(2,'0');
    return `&H${aa}${b}${g}${r}`;
  };

  const cGold    = assColor(GOLD);
  const cSubt    = assColor(SUBTITLE);
  const cBlack   = '&H00000000';
  const cShadow  = assAlpha('000000', 0.7);

  // Style: chapter (large, centred, gold)
  lines.push(`Style: Chapter,Georgia,80,${cGold},${cGold},${cBlack},${cShadow},1,0,0,0,100,100,2,0,1,3,2,5,160,160,80,1`);
  // Style: section head (medium, centred, gold)
  lines.push(`Style: SecHead,Georgia,52,${cGold},${cGold},${cBlack},${cShadow},0,1,0,0,100,100,1,0,1,2,1,5,120,120,60,1`);
  // Style: paragraph (normal, bottom-centred, cream)
  lines.push(`Style: Paragraph,Georgia,42,${cSubt},${cSubt},${cBlack},${cShadow},0,0,0,0,100,100,0,0,1,2,1,2,120,120,60,1`);
  // Style: small section label (top, dim)
  lines.push(`Style: Label,Georgia,32,${assColor(DIM)},${assColor(DIM)},${cBlack},${cShadow},0,0,0,0,100,100,0,0,1,1,0,8,80,80,40,1`);
  lines.push('');

  lines.push('[Events]');
  lines.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');

  // Title card: first 5 seconds
  lines.push(`Dialogue: 0,0:00:00.00,0:00:03.50,Chapter,,0,0,0,,{\\fad(800,800)}${docTitle}`);
  lines.push(`Dialogue: 0,0:00:01.00,0:00:04.50,SecHead,,0,0,0,,{\\fad(600,600)}${docAuthor}`);

  let currentChapter = '';
  for (const entry of timeline) {
    const { block, start, end } = entry;
    const s = srtTime(start).replace(',','.');  // ASS uses dot not comma
    const e = srtTime(end).replace(',','.');
    const text = getReadText(block);
    if (!text) continue;

    if (block.type === 'chapter-header') {
      currentChapter = text;
      lines.push(`Dialogue: 0,${s},${e},Chapter,,0,0,0,,{\\fad(600,600)}${text.replace(/,/g,'\\,')}`);
    } else if (block.type === 'sec-head') {
      lines.push(`Dialogue: 0,${s},${e},SecHead,,0,0,0,,{\\fad(400,400)}${text.replace(/,/g,'\\,')}`);
    } else if (block.type === 'sub-head') {
      lines.push(`Dialogue: 0,${s},${e},SecHead,,0,0,0,,{\\i1}${text.replace(/,/g,'\\,')}{\\i0}`);
    } else if (block.type === 'paragraph') {
      // Label (chapter context) at top
      if (currentChapter) {
        lines.push(`Dialogue: 1,${s},${e},Label,,0,0,0,,${currentChapter.slice(0,60).replace(/,/g,'\\,')}`);
      }
      // Para number top-right
      lines.push(`Dialogue: 1,${s},${e},Label,,0,0,0,,{\\an3}§${block.number ?? block.id}`);
      // Paragraph text, wrapped
      const wrapped = wrapText(text, 80).replace(/,/g,'\\,').replace(/\n/g,'\\N');
      lines.push(`Dialogue: 0,${s},${e},Paragraph,,0,0,0,,${wrapped}`);
    }
  }

  return lines.join('\n') + '\n';
}

/** Also produce an SRT for accessibility / YouTube auto-caption import */
function buildSRT(timeline) {
  const entries = [];
  let idx = 1;
  for (const { block, start, end } of timeline) {
    const text = getReadText(block);
    if (!text) continue;
    const wrapped = wrapText(text, 84);
    entries.push(`${idx}\n${srtTime(start)} --> ${srtTime(end)}\n${wrapped}\n`);
    idx++;
  }
  return entries.join('\n');
}

// ── main ──────────────────────────────────────────────────────────────────

const argSlug = process.argv.includes('--slug')
  ? process.argv[process.argv.indexOf('--slug') + 1]
  : null;

const indexPath = join(ROOT, 'content', 'documents', 'index.json');
const docIndex  = JSON.parse(readFileSync(indexPath, 'utf8'));
const docs      = argSlug ? docIndex.filter(d => d.slug === argSlug) : docIndex;

if (!docs.length) {
  console.error(`No documents found${argSlug ? ` for slug "${argSlug}"` : ''}`);
  process.exit(1);
}

// Verify ffmpeg / ffprobe
for (const bin of [FFMPEG, FFPROBE]) {
  const r = run(bin, ['-version']);
  if (r.status !== 0) { console.error(`${bin} not found. Install via: brew install ffmpeg`); process.exit(1); }
}

const videoDir = join(ROOT, 'public', 'video');
mkdirSync(videoDir, { recursive: true });

const tmpDir = join(ROOT, '.tts-tmp');
mkdirSync(tmpDir, { recursive: true });

for (const docMeta of docs) {
  const { slug, title, author } = docMeta;
  const docPath   = join(ROOT, 'content', 'documents', `${slug}.json`);
  const audioDir  = join(ROOT, 'public', 'audio', slug);
  const outMp4    = join(videoDir, `${slug}.mp4`);
  const outSrt    = join(videoDir, `${slug}.srt`);

  if (!existsSync(docPath)) { console.warn(`Skipping ${slug}: JSON not found`); continue; }
  if (!existsSync(audioDir)) { console.warn(`Skipping ${slug}: no audio at ${audioDir} — run generate-tts-audio.mjs first`); continue; }

  console.log(`\n=== ${title} (${slug}) ===`);

  const doc    = JSON.parse(readFileSync(docPath, 'utf8'));
  const blocks = doc.blocks;

  // ── 1. Measure audio durations ──────────────────────────────────────────
  console.log('  Measuring block durations…');
  const timeline = [];
  let cursor = 0;

  for (const block of blocks) {
    const text = getReadText(block);
    if (!text || text.length < 2) continue;
    const opusPath = join(audioDir, `${block.id}.opus`);
    if (!existsSync(opusPath)) {
      console.warn(`    Missing: ${block.id}.opus — skipping block`);
      continue;
    }
    const dur = getDuration(opusPath);
    if (!dur) { console.warn(`    Zero duration: ${block.id}.opus`); continue; }

    timeline.push({ block, start: cursor, end: cursor + dur, dur, opusPath });
    // Add a small inter-block gap (200ms) except after chapter headers (1s)
    const gap = block.type === 'chapter-header' ? 1.0 : 0.2;
    cursor += dur + gap;
  }

  const totalSeconds = cursor;
  const hms = [Math.floor(totalSeconds/3600), Math.floor((totalSeconds%3600)/60), Math.floor(totalSeconds%60)]
    .map(n => String(n).padStart(2,'0')).join(':');
  console.log(`  Total duration: ${hms} (${timeline.length} blocks)`);

  if (timeline.length === 0) { console.warn('  No audio blocks found — aborting'); continue; }

  // ── 2. Build subtitle files ──────────────────────────────────────────────
  console.log('  Generating subtitles…');
  const assPath = join(tmpDir, `${slug}.ass`);
  const srtPath = outSrt;

  writeFileSync(assPath, buildASS(timeline, title, author ?? ''));
  writeFileSync(srtPath, buildSRT(timeline));
  console.log(`  SRT → ${srtPath}`);

  // ── 3. Concatenate audio via ffmpeg concat ──────────────────────────────
  console.log('  Concatenating audio…');
  const concatListPath = join(tmpDir, `${slug}-concat.txt`);
  const concatLines = timeline.map(({ opusPath }) => `file '${opusPath}'`);
  writeFileSync(concatListPath, concatLines.join('\n') + '\n');

  const concatAacPath = join(tmpDir, `${slug}-audio.aac`);
  if (existsSync(concatAacPath)) unlinkSync(concatAacPath);

  const audioResult = run(FFMPEG, [
    '-y',
    '-f', 'concat', '-safe', '0',
    '-i', concatListPath,
    '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
    concatAacPath,
  ], { maxBuffer: 10 * 1024 * 1024 });

  if (audioResult.status !== 0) {
    console.error('  Audio concat failed:\n', audioResult.stderr);
    continue;
  }
  console.log(`  Audio → ${concatAacPath}`);

  // ── 4. Compose video ────────────────────────────────────────────────────
  console.log('  Compositing video (this may take several minutes)…');
  if (existsSync(outMp4)) unlinkSync(outMp4);

  // Background lavfi color source → burn ASS subtitles
  const videoResult = run(FFMPEG, [
    '-y',
    '-f', 'lavfi', '-i', `color=c=#${BG}:s=${VIDEO_W}x${VIDEO_H}:r=24`,
    '-i', concatAacPath,
    '-filter_complex', `ass='${assPath}'`,
    '-c:v', 'libx264', '-crf', '20', '-preset', 'slow',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    '-shortest',
    outMp4,
  ], { maxBuffer: 50 * 1024 * 1024 });

  if (videoResult.status !== 0) {
    console.error('  Video compose failed:\n', videoResult.stderr?.slice(-2000));
    continue;
  }

  const sizeMB = (existsSync(outMp4)
    ? parseInt(run('du', ['-k', outMp4]).stdout.split('\t')[0]) / 1024
    : 0).toFixed(0);
  console.log(`  Video → ${outMp4} (${sizeMB} MB)`);

  // ── 5. Cleanup temp files ───────────────────────────────────────────────
  [concatListPath, concatAacPath, assPath].forEach(f => { try { unlinkSync(f); } catch { /* ignore */ } });
}

console.log('\nDone.');
