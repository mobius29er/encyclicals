/**
 * generate-tts-audio.mjs
 * Pre-generates Kokoro TTS audio (am_onyx, 1×) for every readable block
 * in every document, saves as opus files via ffmpeg.
 *
 * Usage:  node scripts/generate-tts-audio.mjs
 *
 * Output: public/audio/<slug>/<block-id>.opus
 *
 * Requirements: ffmpeg in PATH (brew install ffmpeg)
 * Re-runnable: already-generated files are skipped automatically.
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const VOICE = 'am_onyx';
const SPEED = 1.0;

// ── helpers ─────────────────────────────────────────────────────────────────

function getReadText(block) {
  if (block.type === 'paragraph') {
    return block.html
      .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '')
      .replace(/<[^>]+>/g, '')
      .trim();
  }
  if (block.type === 'chapter-header') return block.title ?? '';
  if (['sec-head', 'sub-head', 'signature'].includes(block.type)) {
    return (block.html ?? '').replace(/<[^>]+>/g, '').trim();
  }
  return '';
}

/** Convert Float32Array PCM to a 16-bit mono WAV Buffer */
function toWav(float32, sampleRate) {
  const numSamples = float32.length;
  const byteRate   = sampleRate * 2;          // 1 ch × 16-bit
  const dataSize   = numSamples * 2;
  const buf        = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);                   // PCM
  buf.writeUInt16LE(1, 22);                   // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(2, 32);                   // block align
  buf.writeUInt16LE(16, 34);                  // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

function hasFfmpeg() {
  const r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  return r.status === 0;
}

function wavToOpus(wavPath, opusPath) {
  const r = spawnSync('ffmpeg', [
    '-y', '-i', wavPath,
    '-c:a', 'libopus', '-b:a', '24k',
    '-vbr', 'on', '-compression_level', '10',
    opusPath,
  ], { stdio: 'pipe' });
  return r.status === 0;
}

// ── main ────────────────────────────────────────────────────────────────────

if (!hasFfmpeg()) {
  console.error('ffmpeg not found. Install with: brew install ffmpeg');
  process.exit(1);
}

console.log('Loading Kokoro TTS model (CPU)…');
const { KokoroTTS } = await import('kokoro-js');
const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
  dtype: 'q8',
  device: 'cpu',
});
console.log('Model loaded.\n');

const index = JSON.parse(readFileSync(join(ROOT, 'content/documents/index.json'), 'utf8'));

for (const { slug } of index) {
  const docPath = join(ROOT, `content/documents/${slug}.json`);
  if (!existsSync(docPath)) { console.warn(`Missing: ${docPath}`); continue; }

  const doc    = JSON.parse(readFileSync(docPath, 'utf8'));
  const outDir = join(ROOT, `public/audio/${slug}`);
  mkdirSync(outDir, { recursive: true });

  const blocks = doc.blocks ?? [];
  let done = 0, skipped = 0, failed = 0;

  console.log(`\n── ${slug} (${blocks.length} blocks) ──`);

  for (const block of blocks) {
    const text = getReadText(block);
    if (!text || text.length < 3) continue;

    const opusPath = join(outDir, `${block.id}.opus`);
    if (existsSync(opusPath)) { skipped++; continue; }

    process.stdout.write(`  ${block.id.padEnd(18)} `);

    let raw;
    try {
      raw = await tts.generate(text, { voice: VOICE, speed: SPEED });
    } catch (err) {
      console.log(`GENERATE FAILED: ${err.message}`);
      failed++;
      continue;
    }

    const wavPath = join(outDir, `_tmp_${block.id}.wav`);
    writeFileSync(wavPath, toWav(raw.audio, raw.sampling_rate));

    const ok = wavToOpus(wavPath, opusPath);
    unlinkSync(wavPath);

    if (ok) {
      const kb = Math.round(existsSync(opusPath)
        ? readFileSync(opusPath).length / 1024 : 0);
      console.log(`✓  ${kb} KB`);
      done++;
    } else {
      console.log('FFMPEG FAILED');
      failed++;
    }
  }

  console.log(`\n  Done: ${done}  Skipped: ${skipped}  Failed: ${failed}`);
}

console.log('\nAll documents processed.');
