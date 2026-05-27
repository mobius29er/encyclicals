# Encyclicals

A modular Next.js + TypeScript reader for Catholic encyclicals and doctrinal documents, with the original `index.html` preserved as an archive source file.

## Current structure

```text
.
├── app/                         # Next.js App Router pages and global styles
├── components/                  # Reader UI components
├── content/documents/           # Extracted JSON content catalog and documents
├── lib/                         # Browser storage and focus-mode helpers
├── scripts/                     # HTML/PDF ingestion utilities
├── types/                       # Shared document types
├── index.html                   # Archived single-file source
└── .github/workflows/           # GitHub Pages deployment workflow
```

## Getting started

```bash
npm install
npm run extract:html
npm run dev
```

Then open <http://localhost:3000>.

## Build for GitHub Pages

```bash
npm run build
```

The static export is written to `out/` and deployed by `.github/workflows/deploy-pages.yml`.

## Content workflows

- `npm run extract:html` parses `index.html` into structured JSON.
- `node scripts/extract-pdf.mjs <pdf> <slug> [options]` generates a draft JSON document from a PDF.

## Archive note

The original `index.html` is intentionally kept in the repository as the source archive for the initial single-file version of the site.
