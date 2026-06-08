#!/usr/bin/env node
/**
 * studio-server.mjs — local web studio for ingesting documents and producing
 * narration + video on your own machine.
 *
 *   npm run studio   →   http://localhost:4321
 *
 * Upload a file (PDF / HTML / text), give a URL, or a Bible reference; pick an
 * adapter and a narration voice; then ingest → narrate → render video, watching
 * live progress. Everything runs locally by shelling out to the existing
 * pipeline scripts. Uses only Node built-ins so it never affects the static
 * GitHub Pages export.
 */

import { createServer } from 'http';
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname, extname, basename } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = process.env.STUDIO_PORT ? parseInt(process.env.STUDIO_PORT, 10) : 4321;

const TMP = join(ROOT, '.studio-tmp');
const UPLOADS = join(TMP, 'uploads');
const CONFIGS = join(TMP, 'configs');
for (const d of [TMP, UPLOADS, CONFIGS]) mkdirSync(d, { recursive: true });

const DOCS_DIR = join(ROOT, 'content', 'documents');
const INDEX = join(DOCS_DIR, 'index.json');
const AUDIO_DIR = join(ROOT, 'public', 'audio');
const VIDEO_DIR = join(ROOT, 'public', 'video');
const VOICES_DIR = join(ROOT, 'node_modules', 'kokoro-js', 'voices');

// ── voices ────────────────────────────────────────────────────────────────────
const LANGS = { a: 'American English', b: 'British English', e: 'Spanish', f: 'French',
  h: 'Hindi', i: 'Italian', j: 'Japanese', p: 'Portuguese', z: 'Mandarin' };
function listVoices() {
  let names = [];
  try { names = readdirSync(VOICES_DIR).filter((f) => f.endsWith('.bin')).map((f) => f.replace(/\.bin$/, '')); }
  catch { names = ['am_onyx', 'af_heart', 'bm_george', 'bf_emma']; }
  return names.sort().map((id) => {
    const lang = LANGS[id[0]] || 'Other';
    const gender = id[1] === 'f' ? 'Female' : id[1] === 'm' ? 'Male' : '';
    const person = id.split('_')[1] || id;
    return { id, label: `${person[0].toUpperCase()}${person.slice(1)} — ${lang} ${gender}`.trim(), lang, gender };
  });
}

// ── jobs ──────────────────────────────────────────────────────────────────────
const jobs = new Map(); // id → { id, kind, slug, status, code, logs:[], subs:Set<res> }

function newJob(kind, slug) {
  const job = { id: randomUUID(), kind, slug, status: 'running', code: null, logs: [], subs: new Set() };
  jobs.set(job.id, job);
  return job;
}
function emit(job, line) {
  job.logs.push(line);
  for (const res of job.subs) res.write(`data: ${JSON.stringify({ line })}\n\n`);
}
function finish(job, code) {
  job.status = code === 0 ? 'done' : 'error';
  job.code = code;
  for (const res of job.subs) {
    res.write(`event: end\ndata: ${JSON.stringify({ status: job.status, code })}\n\n`);
    res.end();
  }
  job.subs.clear();
}
/** Spawn a node script, stream output into the job. */
function runScript(job, args) {
  emit(job, `$ node ${args.join(' ')}`);
  const child = spawn(process.execPath, args, { cwd: ROOT, env: process.env });
  let buf = '';
  const onData = (d) => {
    buf += d.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const l of lines) emit(job, l);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('close', (code) => { if (buf) emit(job, buf); finish(job, code ?? 1); });
  child.on('error', (err) => { emit(job, `spawn error: ${err.message}`); finish(job, 1); });
}

// ── HTTP helpers ────────────────────────────────────────────────────────────────
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);

function audioStatus(slug) {
  try {
    const doc = JSON.parse(readFileSync(join(DOCS_DIR, `${slug}.json`), 'utf8'));
    const readable = doc.blocks.filter((b) =>
      (b.type === 'paragraph' && b.html) ||
      (['chapter-header', 'sec-head', 'sub-head', 'signature'].includes(b.type))).length;
    const dir = join(AUDIO_DIR, slug);
    const have = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.opus')).length : 0;
    return { readable, have };
  } catch { return { readable: 0, have: 0 }; }
}

// ── route handlers ──────────────────────────────────────────────────────────────
async function handleIngest(req, res) {
  const body = JSON.parse((await readBody(req)).toString() || '{}');
  const slug = slugify(body.slug || body.meta?.title || 'document');
  if (!slug) return send(res, 400, { error: 'slug or title required' });

  const adapter = body.adapter;
  let source;
  if (adapter === 'bible') {
    source = { type: 'bible', value: body.source };
  } else if (body.sourceType === 'url') {
    source = { type: 'url', value: body.source, cache: join(TMP, `${slug}.src`) };
  } else if (body.sourceType === 'paste') {
    const p = join(UPLOADS, `${slug}.txt`);
    writeFileSync(p, body.source || '');
    source = { type: 'text', value: p };
  } else if (body.sourceType === 'upload') {
    source = { type: body.uploadType || 'text', value: body.source }; // server path from /api/upload
  } else {
    return send(res, 400, { error: 'unknown source' });
  }

  const config = {
    slug, adapter, source,
    translation: body.translation || undefined,
    signatureName: body.signatureName || undefined,
    footnotes: body.footnoteStyle ? { markerStyle: body.footnoteStyle } : undefined,
    meta: body.meta || {},
  };
  const cfgPath = join(CONFIGS, `${slug}.json`);
  writeFileSync(cfgPath, JSON.stringify(config, null, 2));

  const job = newJob('ingest', slug);
  send(res, 200, { jobId: job.id, slug });
  runScript(job, ['scripts/ingest-document.mjs', cfgPath]);
}

async function handleTts(req, res) {
  const body = JSON.parse((await readBody(req)).toString() || '{}');
  if (!body.slug) return send(res, 400, { error: 'slug required' });
  const job = newJob('tts', body.slug);
  send(res, 200, { jobId: job.id, slug: body.slug });
  const args = ['scripts/generate-tts-audio.mjs', '--slug', body.slug, '--voice', body.voice || 'am_onyx'];
  if (body.speed) args.push('--speed', String(body.speed));
  if (body.force) args.push('--force');
  runScript(job, args);
}

async function handleVideo(req, res) {
  const body = JSON.parse((await readBody(req)).toString() || '{}');
  if (!body.slug) return send(res, 400, { error: 'slug required' });
  const job = newJob('video', body.slug);
  send(res, 200, { jobId: job.id, slug: body.slug });
  const args = ['scripts/generate-video.mjs', '--slug', body.slug];
  if (body.noBg) args.push('--no-bg');
  runScript(job, args);
}

async function handleUpload(req, res) {
  const name = basename(req.headers['x-filename'] || `upload-${Date.now()}`);
  const data = await readBody(req);
  const p = join(UPLOADS, name);
  writeFileSync(p, data);
  const ext = extname(name).toLowerCase();
  const uploadType = ext === '.pdf' ? 'pdf' : (ext === '.html' || ext === '.htm') ? 'html' : 'text';
  send(res, 200, { path: p, name, uploadType, size: data.length });
}

// ── server ──────────────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = url.pathname;

    if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
      const html = readFileSync(join(__dirname, 'studio', 'index.html'), 'utf8');
      return send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8' });
    }
    if (req.method === 'GET' && path === '/api/voices') return send(res, 200, { voices: listVoices() });
    if (req.method === 'GET' && path === '/api/documents') {
      const cat = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : [];
      const docs = cat.map((d) => ({
        ...d,
        audio: audioStatus(d.slug),
        video: existsSync(join(VIDEO_DIR, `${d.slug}.mp4`)),
      }));
      return send(res, 200, { documents: docs });
    }
    if (req.method === 'GET' && path === '/api/audio-status') {
      return send(res, 200, audioStatus(url.searchParams.get('slug')));
    }
    if (req.method === 'POST' && path === '/api/upload') return handleUpload(req, res);
    if (req.method === 'POST' && path === '/api/ingest') return handleIngest(req, res);
    if (req.method === 'POST' && path === '/api/tts') return handleTts(req, res);
    if (req.method === 'POST' && path === '/api/video') return handleVideo(req, res);

    const jobMatch = path.match(/^\/api\/job\/([0-9a-f-]+)(\/stream)?$/);
    if (req.method === 'GET' && jobMatch) {
      const job = jobs.get(jobMatch[1]);
      if (!job) return send(res, 404, { error: 'no such job' });
      if (jobMatch[2]) { // SSE stream
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        for (const line of job.logs) res.write(`data: ${JSON.stringify({ line })}\n\n`);
        if (job.status !== 'running') {
          res.write(`event: end\ndata: ${JSON.stringify({ status: job.status, code: job.code })}\n\n`);
          return res.end();
        }
        job.subs.add(res);
        req.on('close', () => job.subs.delete(res));
        return;
      }
      return send(res, 200, { id: job.id, kind: job.kind, slug: job.slug, status: job.status, code: job.code, logs: job.logs });
    }

    send(res, 404, { error: 'not found' });
  } catch (err) {
    send(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n  Encyclicals Studio  →  http://localhost:${PORT}\n`);
  console.log(`  ${listVoices().length} narration voices available. Press Ctrl+C to stop.\n`);
});
