export type BlockType = 'chapter-header' | 'paragraph' | 'sec-head' | 'sub-head' | 'signature';

export interface Footnote {
  num: string;
  text: string;
}

export interface TocSection {
  id: string;
  label: string;
}

export interface TocChapter {
  type: 'chapter';
  id: string;
  label: string;
  sections: TocSection[];
}

export interface ChapterHeaderBlock {
  type: 'chapter-header';
  id: string;
  tag: string;
  title: string;
}

export interface ParagraphBlock {
  type: 'paragraph';
  id: string;
  number: number;
  html: string;
  footnotes: Footnote[];
}

export interface SecHeadBlock {
  type: 'sec-head';
  id: string;
  html: string;
}

export interface SubHeadBlock {
  type: 'sub-head';
  id: string;
  html: string;
}

export interface SignatureBlock {
  type: 'signature';
  id: string;
  html: string;
}

export type DocumentBlock = ChapterHeaderBlock | ParagraphBlock | SecHeadBlock | SubHeadBlock | SignatureBlock;

export interface DocumentMeta {
  slug: string;
  title: string;
  subtitle?: string;
  author: string;
  date: string;
  dateDisplay: string;
  type: string;
  summary: string;
  source?: string;
}

export interface DocumentData extends DocumentMeta {
  toc: TocChapter[];
  blocks: DocumentBlock[];
}
