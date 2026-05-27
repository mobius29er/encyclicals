#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { load } from 'cheerio';

const root = process.cwd();
const htmlPath = path.join(root, 'index.html');
const outputDir = path.join(root, 'content', 'documents');
const outputPath = path.join(outputDir, 'magnifica-humanitas.json');
const catalogPath = path.join(outputDir, 'index.json');

const html = readFileSync(htmlPath, 'utf8');
const $ = load(html);
const main = $('main#main');

if (!main.length) {
  throw new Error('Could not find <main id="main"> in index.html');
}

const toc = [];
let currentChapter = null;
$('.side .toc-ch, .side .toc-sec').each((_, el) => {
  const link = $(el);
  const id = (link.attr('href') || '').replace(/^#/, '');
  const label = link.text().trim();
  if (!id) return;
  if (link.hasClass('toc-ch')) {
    currentChapter = { type: 'chapter', id, label, sections: [] };
    toc.push(currentChapter);
  } else if (currentChapter) {
    currentChapter.sections.push({ id, label });
  }
});

const blocks = [];
main.children().each((_, el) => {
  const node = $(el);

  if (node.hasClass('chapter-header')) {
    blocks.push({
      type: 'chapter-header',
      id: node.attr('id') || '',
      tag: node.find('.chapter-tag').text().trim(),
      title: node.find('h2').text().trim(),
    });
    return;
  }

  if (node.hasClass('sec-head')) {
    blocks.push({
      type: 'sec-head',
      id: node.attr('id') || '',
      html: node.html()?.trim() || node.text().trim(),
    });
    return;
  }

  if (node.hasClass('sub-head')) {
    blocks.push({
      type: 'sub-head',
      id: node.attr('id') || '',
      html: node.html()?.trim() || node.text().trim(),
    });
    return;
  }

  if (node.hasClass('card')) {
    const paragraph = node.find('.card-text p').first();
    const number = Number.parseInt(node.find('.card-num').first().text().trim(), 10);
    const footnotes = node
      .find('.fn-row')
      .map((__, fn) => ({
        num: $(fn).find('.fn-num').text().trim().replace(/\.$/, ''),
        text: $(fn).find('.fn-text').html()?.trim() || $(fn).find('.fn-text').text().trim(),
      }))
      .get();

    blocks.push({
      type: 'paragraph',
      id: node.attr('id') || '',
      number: Number.isNaN(number) ? 0 : number,
      html: paragraph.html()?.trim() || '',
      footnotes,
    });
  }
});

const documentData = {
  slug: 'magnifica-humanitas',
  title: 'Magnifica Humanitas',
  subtitle: 'On Human Dignity in the Age of Artificial Intelligence',
  author: 'Pope Leo XIV',
  date: '2026-05-15',
  dateDisplay: 'May 15, 2026',
  type: 'encyclical',
  summary:
    "Pope Leo XIV's first social encyclical addresses human dignity, artificial intelligence, the common good, and the civilization of love in the digital age.",
  source: 'Vatican, 2026',
  toc,
  blocks,
};

const catalog = [
  {
    slug: 'magnifica-humanitas',
    title: 'Magnifica Humanitas',
    author: 'Pope Leo XIV',
    date: '2026-05-15',
    dateDisplay: 'May 15, 2026',
    type: 'encyclical',
    summary:
      "Pope Leo XIV's first social encyclical addresses human dignity, artificial intelligence, the common good, and the civilization of love in the digital age.",
  },
];

mkdirSync(outputDir, { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(documentData, null, 2)}\n`);
writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
console.log(`Wrote ${catalogPath}`);
console.log(`Extracted ${blocks.length} blocks across ${toc.length} chapters.`);
