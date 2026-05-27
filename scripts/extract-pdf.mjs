#!/usr/bin/env node
/**
 * Extract text from a PDF and produce a draft JSON document for the encyclicals app.
 * 
 * Usage:
 *   node scripts/extract-pdf.mjs <path-to-pdf> <slug> [--title "Title"] [--author "Author"] [--date "YYYY-MM-DD"]
 * 
 * Output:
 *   content/documents/<slug>.json  (draft — requires manual cleanup of footnotes, headings, broken paragraphs)
 *   content/documents/index.json   (updated catalog)
 * 
 * Dependencies (install once):
 *   npm install pdfjs-dist
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { parseArgs } from 'util';

const { values: args, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    title: { type: 'string', default: '' },
    author: { type: 'string', default: '' },
    date: { type: 'string', default: '' },
    type: { type: 'string', default: 'encyclical' },
    summary: { type: 'string', default: '' },
  },
  allowPositionals: true,
});

const [pdfPath, slug] = positionals;

if (!pdfPath || !slug) {
  console.error('Usage: node scripts/extract-pdf.mjs <path-to-pdf> <slug> [options]');
  process.exit(1);
}

const absPath = resolve(pdfPath);
if (!existsSync(absPath)) {
  console.error('File not found:', absPath);
  process.exit(1);
}

let pdfjsLib;
try {
  pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
} catch {
  console.error('pdfjs-dist not installed. Run: npm install pdfjs-dist');
  process.exit(1);
}

console.log(`Reading ${absPath}...`);
const data = new Uint8Array(readFileSync(absPath));
const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
const numPages = doc.numPages;
console.log(`${numPages} pages found.`);

let allText = '';
for (let i = 1; i <= numPages; i++) {
  const page = await doc.getPage(i);
  const content = await page.getTextContent();
  const lines = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
  allText += `${lines}\n`;
}

const rawParagraphs = allText
  .split(/\n{2,}/)
  .map((s) => s.replace(/\s+/g, ' ').trim())
  .filter((s) => s.length > 40);

const blocks = rawParagraphs.map((text, i) => ({
  type: 'paragraph',
  id: `p${i + 1}`,
  number: i + 1,
  html: text,
  footnotes: [],
}));

const title = args.title || slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const dateDisplay = args.date
  ? new Date(args.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  : '';

const output = {
  slug,
  title,
  subtitle: '',
  author: args.author || '',
  date: args.date || '',
  dateDisplay,
  type: args.type,
  summary: args.summary || `Draft extracted from ${slug}.pdf. Requires manual review.`,
  source: '',
  toc: [],
  blocks,
};

const outPath = join(process.cwd(), 'content', 'documents', `${slug}.json`);
writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`Wrote ${blocks.length} paragraphs to ${outPath}`);
console.log('⚠️  This is a draft — manually review and fix:');
console.log('   - Footnotes (currently empty)');
console.log('   - Chapter/section headers (currently typed as paragraphs)');
console.log('   - Broken or merged paragraphs');
console.log('   - Page number artifacts');
console.log('   - TOC structure');

const catalogPath = join(process.cwd(), 'content', 'documents', 'index.json');
let catalog = [];
if (existsSync(catalogPath)) catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const existing = catalog.findIndex((d) => d.slug === slug);
const meta = {
  slug,
  title,
  author: args.author || '',
  date: args.date || '',
  dateDisplay,
  type: args.type,
  summary: output.summary,
};
if (existing >= 0) catalog[existing] = meta;
else catalog.push(meta);
writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
console.log(`Updated catalog at ${catalogPath}`);
