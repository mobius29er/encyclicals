#!/usr/bin/env node
/**
 * ingest-document.mjs — universal document ingester for the encyclicals app.
 *
 * Turns a source document (encyclical, Bible passage, or arbitrary church text)
 * into the reader/narration JSON schema at content/documents/<slug>.json and
 * registers it in content/documents/index.json. The output is consumed
 * unchanged by generate-tts-audio.mjs and generate-video.mjs.
 *
 * USAGE
 *   node scripts/ingest-document.mjs <config.json>
 *   node scripts/ingest-document.mjs --source <url|file> --slug <slug> \
 *        --adapter <encyclical|bible|generic-html|text|pdf> \
 *        [--title T] [--author A] [--date YYYY-MM-DD] [--subtitle S] [--summary X]
 *
 * A config file is preferred for non-trivial documents because it carries the
 * editorial bits the parser cannot infer: chapter divisions, OCR fixes, and
 * metadata. See scripts/ingest/*.json for examples.
 *
 * ADAPTERS
 *   encyclical    Numbered-paragraph documents (Vatican / papalencyclicals HTML).
 *                 Auto-detects salutation, body, references, footnote markers and
 *                 signature; merges continuation paragraphs; splits merged numbers.
 *   bible         Verse-structured text via a public-domain JSON Bible API.
 *                 Books/chapters become chapter-headers, verses become paragraphs.
 *   generic-html  Any HTML: <h1..h4> → chapter/sub-head, <p> → paragraph.
 *   text          Plain text: blank-line paragraphs, ALL-CAPS/short lines → heads.
 *   pdf           Extract text from a local PDF, then run the text adapter.
 *
 * Dependencies: cheerio (present). pdf adapter also needs pdfjs-dist.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname, resolve, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';
import * as cheerio from 'cheerio';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── small utilities ───────────────────────────────────────────────────────────
const NBSP = / /g;
const norm = (s) => (s || '').replace(NBSP, ' ').replace(/\s+/g, ' ').trim();

/** Apply [find, replace] string fixes across a block of text. Warn if absent. */
function applyFixes(text, fixes, label = '') {
  let out = text;
  for (const [find, repl] of fixes || []) {
    if (out.includes(find)) out = out.split(find).join(repl);
    else console.warn(`  ⚠ fix not applied${label ? ` (${label})` : ''}: "${find}"`);
  }
  return out;
}

// ── acquisition: fetch / read raw bytes for any source ────────────────────────
async function acquire(source) {
  // source: { type: 'url'|'html'|'text'|'pdf'|'bible', value, cache?, ...}
  const { type, value, cache } = source;
  if (type === 'bible') return null; // bible adapter fetches its own JSON
  if (type === 'url') {
    if (cache && existsSync(cache)) return readFileSync(cache, 'utf8');
    console.log(`  Downloading ${value} …`);
    const res = await fetch(value);
    if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${value}`);
    const body = await res.text();
    if (cache) { mkdirSync(dirname(cache), { recursive: true }); writeFileSync(cache, body); }
    return body;
  }
  const path = isAbsolute(value) ? value : resolve(ROOT, value);
  if (!existsSync(path)) throw new Error(`Source file not found: ${path}`);
  if (type === 'pdf') return path;            // pdf adapter reads the path
  return readFileSync(path, 'utf8');          // html | text
}

// ── footnote markers: [N] or (N) → <sup>, collect refs ────────────────────────
function detectMarkerStyle(text) {
  const bracket = (text.match(/\[\d{1,3}\]/g) || []).length;
  const paren = (text.match(/\(\d{1,3}\)/g) || []).length;
  return bracket >= paren ? 'bracket' : 'paren';
}
function footnoteRegex(style) {
  return style === 'paren' ? /\((\d{1,3})\)/g : /\[(\d{1,3})\]/g;
}
function attachFootnotes(text, style, refs) {
  const footnotes = [];
  const html = text.replace(footnoteRegex(style), (_, n) => {
    if (refs && refs[n]) footnotes.push({ num: String(n), text: refs[n] });
    return `<sup class="fn" data-fn="${n}">${n}</sup>`;
  });
  return { html, footnotes };
}

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTER: encyclical (numbered-paragraph HTML)
// ─────────────────────────────────────────────────────────────────────────────
function adapterEncyclical(html, config) {
  const $ = cheerio.load(html);
  const ps = $('p').map((_, el) => norm($(el).text())).get();

  // 1. references — from a <ul>/<ol> of "N. …" items, or <p> after "REFERENCES:"
  const refs = parseReferenceList($, ps);

  // 2. salutation + signature anchors
  const addrIdx = ps.findIndex((t) =>
    /venerable br-?eth|venerable brother|apostolic benediction|to our venerable/i.test(t));
  const sigIdx = ps.findIndex((t) => /^given (at|in)\b/i.test(t));
  const address = addrIdx >= 0 ? ps[addrIdx] : '';
  const signature = sigIdx >= 0 ? ps[sigIdx].replace(/\s+\./g, '.') : '';

  // 3. body candidates: between salutation and signature, real prose only
  const start = addrIdx >= 0 ? addrIdx + 1 : 0;
  const end = sigIdx >= 0 ? sigIdx : ps.length;
  const body = ps.slice(start, end).filter((t) => t.length >= 25 || /^\d{1,3}[.)]/.test(t));

  // 4. sequential split into official paragraphs 1..N (global, marker-driven)
  const joined = applyFixes(body.join(' '), config.fixes, 'encyclical');
  const style = config.footnotes?.markerStyle || detectMarkerStyle(joined);
  const paras = splitNumberedParagraphs(joined);

  // 5. emit nodes (paragraphs carry footnotes; address/signature as sub-heads)
  const nodes = [];
  if (address) nodes.push({ kind: 'subhead', id: 'address', html: address });
  for (const { num, text } of paras) {
    const { html: pHtml, footnotes } = attachFootnotes(text, style, refs);
    nodes.push({ kind: 'paragraph', id: `p${num}`, number: num, html: pHtml, footnotes });
  }
  if (signature) nodes.push({ kind: 'subhead', id: 'signature', html: `${signature} — ${config.signatureName || ''}`.replace(/ — $/, '') });
  return { nodes, paragraphCount: paras.length };
}

function parseReferenceList($, ps) {
  // (a) list items
  let best = null;
  $('ul,ol').each((_, el) => {
    const items = $(el).find('li').map((__, li) => norm($(li).text())).get();
    const numbered = items.filter((t) => /^\d{1,3}[.)]/.test(t)).length;
    if (items.length >= 5 && numbered / items.length > 0.5 && (!best || items.length > best.length))
      best = items;
  });
  // (b) Vatican style: <p> entries following a "REFERENCES" heading
  if (!best) {
    const ri = ps.findIndex((t) => /^references\b/i.test(t));
    if (ri >= 0) best = ps.slice(ri + 1).filter((t) => /^\d{1,3}[.)]/.test(t));
  }
  if (!best || !best.length) return {};
  // entries may merge multiple "N. …" — re-split sequentially across joined text
  const joined = best.join(' ');
  const refs = {};
  let n = 1, pos = 0;
  while (true) {
    const m = findMarker(joined, n, pos);
    if (m < 0) break;
    const next = findMarker(joined, n + 1, m + 1);
    refs[n] = joined.slice(m, next < 0 ? joined.length : next).replace(/^\d{1,3}[.)]\s*/, '').trim();
    pos = m + 1; n++;
  }
  return refs;
}

/** Index of the start of marker `n` (e.g. "n." or "n)" or "n ") at/after `from`. */
function findMarker(text, n, from = 0) {
  const re = new RegExp(`(?:^|\\s)${n}\\b[.)]?\\s+`, 'g');
  re.lastIndex = from;
  const m = re.exec(text);
  if (!m) return -1;
  // start position of the digit itself
  return m.index + (/^\s/.test(m[0]) ? 1 : 0);
}

/** Split a continuous encyclical body into [{num,text}] using sequential markers. */
function splitNumberedParagraphs(text) {
  // locate markers for n = 2,3,… (paragraph 1 is unnumbered prose at the front)
  const starts = [];
  let n = 2, pos = 0;
  while (true) {
    const at = findMarker(text, n, pos);
    if (at < 0) break;
    starts.push({ num: n, at });
    pos = at + 1; n++;
  }
  const out = [];
  if (!starts.length) { out.push({ num: 1, text: text.trim() }); return out; }
  out.push({ num: 1, text: text.slice(0, starts[0].at).trim() });
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i].at;
    const e = i + 1 < starts.length ? starts[i + 1].at : text.length;
    out.push({ num: starts[i].num, text: text.slice(s, e).replace(/^\d{1,3}\b[.)]?\s*/, '').trim() });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTER: bible (public-domain JSON API → books/chapters/verses)
// ─────────────────────────────────────────────────────────────────────────────
async function adapterBible(config) {
  const ref = config.source.value;                 // e.g. "John 3" or "Romans 8"
  const translation = config.translation || 'web'; // public-domain default (World English Bible)
  // Douay-Rheims (and other bolls.life translations) are served by a different
  // API than bible-api.com — route those through the bolls provider.
  if (/^(drb|dra|douay)/i.test(translation)) return adapterBibleBolls(ref, 'DRB');
  const url = `https://bible-api.com/${encodeURIComponent(ref)}?translation=${translation}`;
  console.log(`  Fetching ${url} …`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bible API failed ${res.status} for "${ref}"`);
  const data = await res.json();
  if (!data.verses?.length) throw new Error(`No verses returned for "${ref}"`);

  const nodes = [];
  let lastKey = '';
  for (const v of data.verses) {
    const key = `${v.book_name} ${v.chapter}`;
    if (key !== lastKey) {
      nodes.push({ kind: 'chapter', id: slugify(key), label: key });
      lastKey = key;
    }
    nodes.push({
      kind: 'paragraph',
      id: slugify(`${v.book_name}-${v.chapter}-${v.verse}`),
      number: v.verse,
      html: `<span class="vnum">${v.verse}</span> ${norm(v.text)}`,
      footnotes: [],
    });
  }
  return { nodes, paragraphCount: data.verses.length, autoMeta: { translation: data.translation_name } };
}

// Book-name aliases so traditional Douay-Rheims titles resolve to the API's names.
const BIBLE_ALIASES = {
  apocalypse: 'revelation', 'canticle of canticles': 'song of solomon',
  'song of songs': 'song of solomon', ecclesiasticus: 'sirach', psalm: 'psalms',
  '1 paralipomenon': '1 chronicles', '2 paralipomenon': '2 chronicles', qoheleth: 'ecclesiastes',
};

/** Douay-Rheims (and other bolls.life translations): numeric book ids + HTML verses. */
async function adapterBibleBolls(ref, code) {
  const m = ref.match(/^\s*(.+?)\s+(\d+)(?::(\d+)(?:\s*-\s*(\d+))?)?\s*$/);
  if (!m) throw new Error(`Could not parse reference "${ref}" (expected e.g. "John 3" or "John 3:16-18")`);
  const [, rawBook, chap, vStart, vEnd] = m;
  const wanted = (BIBLE_ALIASES[rawBook.toLowerCase()] || rawBook).toLowerCase().replace(/\s+/g, '');

  const booksUrl = `https://bolls.life/get-books/${code}/`;
  console.log(`  Fetching ${booksUrl} …`);
  const books = await (await fetch(booksUrl)).json();
  const book = books.find((b) => b.name.toLowerCase().replace(/\s+/g, '') === wanted)
    || books.find((b) => b.name.toLowerCase().replace(/\s+/g, '').startsWith(wanted));
  if (!book) throw new Error(`Book "${rawBook}" not found in ${code}`);

  const textUrl = `https://bolls.life/get-text/${code}/${book.bookid}/${chap}/`;
  console.log(`  Fetching ${textUrl} …`);
  let verses = await (await fetch(textUrl)).json();
  if (!Array.isArray(verses) || !verses.length) throw new Error(`No verses for "${ref}" in ${code}`);
  if (vStart) {
    const a = parseInt(vStart, 10), b = vEnd ? parseInt(vEnd, 10) : a;
    verses = verses.filter((v) => v.verse >= a && v.verse <= b);
  }

  const label = `${book.name} ${chap}`;
  const nodes = [{ kind: 'chapter', id: slugify(label), label }];
  for (const v of verses) {
    const text = norm(String(v.text).replace(/<[^>]+>/g, ''));   // strip bolls markup
    nodes.push({
      kind: 'paragraph',
      id: slugify(`${book.name}-${chap}-${v.verse}`),
      number: v.verse,
      html: `<span class="vnum">${v.verse}</span> ${text}`,
      footnotes: [],
    });
  }
  return { nodes, paragraphCount: verses.length, autoMeta: { translation: 'Douay-Rheims' } };
}

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTER: generic-html
// ─────────────────────────────────────────────────────────────────────────────
function adapterGenericHtml(html, config) {
  const $ = cheerio.load(html);
  const root = config.contentSelector ? $(config.contentSelector) : $('body');
  const style = config.footnotes?.markerStyle || 'bracket';
  const nodes = [];
  let pnum = 0;
  root.find('h1,h2,h3,h4,p,li').each((_, el) => {
    const tag = el.tagName.toLowerCase();
    const text = norm($(el).text());
    if (!text || text.length < 2) return;
    if (tag === 'h1' || tag === 'h2') nodes.push({ kind: 'chapter', id: slugify(text), label: text });
    else if (tag === 'h3' || tag === 'h4') nodes.push({ kind: 'subhead', id: slugify(text), html: text });
    else {
      const { html: pHtml, footnotes } = attachFootnotes(text, style, config.refs || {});
      nodes.push({ kind: 'paragraph', id: `p${++pnum}`, number: pnum, html: pHtml, footnotes });
    }
  });
  return { nodes, paragraphCount: pnum };
}

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTER: text (plain text heuristics)
// ─────────────────────────────────────────────────────────────────────────────
function adapterText(raw, config) {
  const fixed = applyFixes(raw.replace(/\r\n/g, '\n'), config.fixes, 'text');
  const chunks = fixed.split(/\n{2,}/).map((s) => s.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
  const style = config.footnotes?.markerStyle || 'bracket';
  const nodes = [];
  let pnum = 0;
  for (const c of chunks) {
    const oneLine = !c.includes('\n');
    const isHeading = oneLine && c.length <= 70 && (c === c.toUpperCase() || /^(chapter|book|part)\b/i.test(c));
    if (isHeading) nodes.push({ kind: 'chapter', id: slugify(c), label: c });
    else {
      const { html: pHtml, footnotes } = attachFootnotes(c.replace(/\n/g, ' '), style, config.refs || {});
      nodes.push({ kind: 'paragraph', id: `p${++pnum}`, number: pnum, html: pHtml, footnotes });
    }
  }
  return { nodes, paragraphCount: pnum };
}

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTER: pdf → text
// ─────────────────────────────────────────────────────────────────────────────
async function adapterPdf(pdfPath, config) {
  let pdfjs;
  try { pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); }
  catch { throw new Error('pdf adapter needs pdfjs-dist: npm install pdfjs-dist'); }
  const data = new Uint8Array(readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n\n';
  }
  return adapterText(text, config);
}

// ── builder: nodes → { meta, toc, blocks } ────────────────────────────────────
function slugify(s) {
  return norm(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function buildDocument(nodes, config) {
  const blocks = [];
  const toc = [];

  if (config.chapters && config.chapters.length) {
    // Editorial chapters wrap paragraph-number ranges (encyclical-style).
    const byNum = new Map();
    const extras = [];
    for (const n of nodes) {
      if (n.kind === 'paragraph' && typeof n.number === 'number') byNum.set(n.number, n);
      else extras.push(n);
    }
    const address = extras.find((n) => n.id === 'address');
    const signature = extras.find((n) => n.id === 'signature');

    for (const ch of config.chapters) {
      blocks.push({ type: 'chapter-header', id: ch.id, tag: ch.tag || '', title: ch.label });
      if (ch.address && address) blocks.push({ type: 'sub-head', id: address.id, html: address.html });
      for (let n = ch.from; n <= ch.to; n++) {
        const p = byNum.get(n);
        if (!p) throw new Error(`Chapter "${ch.id}" references missing paragraph ${n}`);
        blocks.push({ type: 'paragraph', id: p.id, number: p.number, html: p.html, footnotes: p.footnotes || [] });
      }
      toc.push({ type: 'chapter', id: ch.id, label: ch.label, sections: [] });
    }
    if (signature) blocks.push({ type: 'sub-head', id: signature.id, html: signature.html });
  } else {
    // Structural: chapter nodes emitted by the adapter drive the TOC.
    let chapter = null;
    for (const n of nodes) {
      if (n.kind === 'chapter') {
        blocks.push({ type: 'chapter-header', id: n.id, tag: n.tag || '', title: n.label });
        chapter = { type: 'chapter', id: n.id, label: n.label, sections: [] };
        toc.push(chapter);
      } else if (n.kind === 'subhead') {
        blocks.push({ type: 'sub-head', id: n.id, html: n.html });
        if (chapter) chapter.sections.push({ id: n.id, label: norm(n.html.replace(/<[^>]+>/g, '')) });
      } else if (n.kind === 'signature') {
        blocks.push({ type: 'signature', id: n.id, html: n.html });
      } else if (n.kind === 'paragraph') {
        blocks.push({ type: 'paragraph', id: n.id, number: n.number, html: n.html, footnotes: n.footnotes || [] });
      }
    }
  }
  return { toc, blocks };
}

// ── config loading (file + CLI overrides) ─────────────────────────────────────
function loadConfig() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      source: { type: 'string' }, adapter: { type: 'string' }, slug: { type: 'string' },
      title: { type: 'string' }, subtitle: { type: 'string' }, author: { type: 'string' },
      date: { type: 'string' }, summary: { type: 'string' }, type: { type: 'string' },
      'source-type': { type: 'string' }, translation: { type: 'string' },
    },
  });

  let config = {};
  if (positionals[0]) {
    const p = isAbsolute(positionals[0]) ? positionals[0] : resolve(process.cwd(), positionals[0]);
    config = JSON.parse(readFileSync(p, 'utf8'));
  }
  config.meta = config.meta || {};
  if (values.source) {
    const t = values['source-type'] ||
      (/^https?:/i.test(values.source) ? 'url'
        : values.source.endsWith('.pdf') ? 'pdf'
        : values.source.endsWith('.html') || values.source.endsWith('.htm') ? 'html'
        : 'text');
    config.source = { type: t, value: values.source };
  }
  if (values.adapter) config.adapter = values.adapter;
  if (values.slug) config.slug = values.slug;
  if (values.translation) config.translation = values.translation;
  for (const k of ['title', 'subtitle', 'author', 'date', 'summary', 'type']) {
    if (values[k]) config.meta[k] = values[k];
  }
  if (config.source?.type === 'bible' || config.adapter === 'bible') {
    config.adapter = 'bible';
    config.source = { type: 'bible', value: config.source?.value || values.source };
  }
  if (!config.slug) throw new Error('slug is required (config.slug or --slug)');
  if (!config.adapter) throw new Error('adapter is required (config.adapter or --adapter)');
  return config;
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  const config = loadConfig();
  console.log(`Ingesting "${config.slug}" via ${config.adapter} adapter`);

  const raw = await acquire(config.source);
  let result;
  switch (config.adapter) {
    case 'encyclical':   result = adapterEncyclical(raw, config); break;
    case 'bible':        result = await adapterBible(config); break;
    case 'generic-html': result = adapterGenericHtml(raw, config); break;
    case 'text':         result = adapterText(raw, config); break;
    case 'pdf':          result = await adapterPdf(raw, config); break;
    default: throw new Error(`Unknown adapter: ${config.adapter}`);
  }

  const { toc, blocks } = buildDocument(result.nodes, config);

  const m = config.meta;
  const dateDisplay = m.dateDisplay ||
    (m.date ? new Date(m.date + 'T00:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' }) : '');
  const meta = {
    slug: config.slug,
    title: m.title || config.slug,
    subtitle: m.subtitle || '',
    author: m.author || '',
    date: m.date || '',
    dateDisplay,
    type: m.type || 'document',
    summary: m.summary || '',
    source: m.source || '',
  };

  const doc = { ...meta, toc, blocks };
  const outPath = join(ROOT, 'content', 'documents', `${config.slug}.json`);
  writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n');
  const fnCount = blocks.reduce((a, b) => a + (b.footnotes?.length || 0), 0);
  console.log(`  Wrote ${outPath}`);
  console.log(`  ${blocks.length} blocks (${result.paragraphCount} paragraphs, ${fnCount} footnotes, ${toc.length} chapters)`);

  const catalogPath = join(ROOT, 'content', 'documents', 'index.json');
  const catalog = existsSync(catalogPath) ? JSON.parse(readFileSync(catalogPath, 'utf8')) : [];
  const catEntry = { ...meta };
  const i = catalog.findIndex((d) => d.slug === config.slug);
  if (i >= 0) catalog[i] = catEntry; else catalog.push(catEntry);
  writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
  console.log(`  Updated catalog (${catalog.length} documents)`);
}

main().catch((err) => { console.error('Error:', err.message); process.exit(1); });
