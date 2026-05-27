# Encyclicals

Encyclicals is a modular Next.js + TypeScript reader for Catholic encyclicals and doctrinal documents.

The app uses the Next.js App Router with structured JSON document content and reusable reader components. It includes a static export for GitHub Pages while preserving the original `index.html` as an archive source file.

## Features

- Document catalog home page generated from `content/documents/index.json`.
- Static document routes under `/documents/[slug]`.
- Reader toolbar with table-of-contents navigation, search, text-to-speech controls, focus mode, bookmarks, font sizing, and light/dark themes.
- Browser storage for reading position, bookmarks, font size, focus mode, and theme preferences.
- HTML and PDF extraction scripts for turning source documents into editable JSON content.

## Project structure

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

Install dependencies, regenerate JSON from the archived HTML source if needed, and start the development server:

```bash
npm install
npm run extract:html
npm run dev
```

Then open <http://localhost:3000>.

## Available scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Next.js development server. |
| `npm run lint` | Run ESLint across the project. |
| `npm run build` | Build the static export into `out/`. |
| `npm run start` | Start a Next.js server for a built app. |
| `npm run extract:html` | Parse `index.html` into structured JSON document content. |

## Build for GitHub Pages

```bash
npm run build
```

The static export is written to `out/` and deployed by `.github/workflows/deploy-pages.yml`.

## Content workflows

- The document catalog lives in `content/documents/index.json`.
- Extracted document JSON files live in `content/documents/`.
- `npm run extract:html` parses `index.html` into structured JSON.
- `node scripts/extract-pdf.mjs <pdf> <slug> [options]` generates a draft JSON document from a PDF.
- Review generated JSON before committing so titles, metadata, section breaks, and summaries are accurate.

## Validation

Before submitting changes, run:

```bash
npm run lint
npm run build
```

## Archive note

The original `index.html` is intentionally kept in the repository as the source archive for the initial single-file version of the site.
