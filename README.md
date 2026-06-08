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
├── LICENSE                      # MIT license
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

The static export is written to `out/` and deployed by `.github/workflows/deploy-pages.yml`. Production builds use the `/encyclicals` base path for GitHub Pages.

## Content workflows

- The document catalog lives in `content/documents/index.json`.
- Extracted document JSON files live in `content/documents/`.
- `npm run extract:html` parses `index.html` into structured JSON.
- `node scripts/extract-pdf.mjs <pdf> <slug> [options]` generates a draft JSON document from a PDF.
- Review generated JSON before committing so titles, metadata, section breaks, and summaries are accurate.

### Universal ingester

`scripts/ingest-document.mjs` turns any source document — an encyclical, a Bible
passage, or arbitrary church text — into the reader/narration JSON schema and
registers it in the catalog. Its output is consumed unchanged by the TTS and
video scripts.

```bash
# Drive a document from a config file (preferred for chapters/footnotes/fixes)
node scripts/ingest-document.mjs scripts/ingest/rerum-novarum.json

# Or pass everything on the command line
node scripts/ingest-document.mjs --adapter bible --source "John 3" \
  --slug john-3 --title "Gospel of John 3" --type scripture
```

Adapters (chosen with `--adapter` or `"adapter"` in the config):

| Adapter | Input | Notes |
| --- | --- | --- |
| `encyclical` | Vatican / papalencyclicals HTML | Auto-detects salutation, body, references, footnote markers (`[N]`/`(N)`) and signature; merges continuation paragraphs and splits merged numbers. |
| `bible` | reference string (e.g. `"Romans 8"`) | Fetches a public-domain translation; books/chapters → headers, verses → paragraphs. `--translation` defaults to `web`. |
| `generic-html` | any HTML | `<h1..h4>` → chapter/sub-head, `<p>` → paragraph. |
| `text` | plain `.txt` / paste | Blank-line paragraphs; ALL-CAPS / `Chapter…` lines → headers. |
| `pdf` | local PDF | Extracts text (needs `pdfjs-dist`), then runs the `text` adapter. |

Config files live in `scripts/ingest/` and carry the editorial details the
parser cannot infer: `meta` (title/author/date/summary), optional `chapters`
(editorial divisions that build the table of contents), `footnotes.markerStyle`,
and `fixes` (a list of `[find, replace]` pairs for source OCR corrections). See
`scripts/ingest/rerum-novarum.json` for a complete example.

### Producing audio and video

```bash
node scripts/generate-tts-audio.mjs            # per-block Kokoro narration → public/audio/<slug>/
node scripts/generate-video.mjs --slug <slug>  # 1080p MP4 + SRT → public/video/<slug>.*
```

Both scripts iterate the catalog and skip work that already exists, so adding a
new document only generates that document's assets.

The TTS script takes `--slug <slug>`, `--voice <name>` (any Kokoro voice, e.g.
`am_onyx`, `bf_emma`), `--speed <n>`, and `--force` (regenerate existing audio).

### Studio (local UI)

For a point-and-click workflow, run the local studio:

```bash
npm run studio          # → http://localhost:4321
```

It is a self-contained local server (Node built-ins only, so it does not affect
the static export). From the browser you can upload a file / paste text / give a
URL or Bible reference, pick an adapter and a narration voice, then **ingest →
narrate → render video** with live progress, and see every document's narration
and video status in one library view. Uploads, generated configs, and source
caches live under `.studio-tmp/` (gitignored).

## Validation

Before submitting changes, run:

```bash
npm run lint
npm run build
```

## Archive note

The original `index.html` is intentionally kept in the repository as the source archive for the initial single-file version of the site.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
