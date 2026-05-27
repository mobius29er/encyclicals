# Encyclicals

A lightweight, static reader for **Magnifica Humanitas — Pope Leo XIV**. The site is built as a single HTML file and is published with GitHub Pages.

## What is in this repo?

This repository currently contains a standalone web page (`index.html`) with the full reading experience, including:

- Responsive table of contents
- Light and dark themes
- Adjustable font size
- Search with match navigation
- Bookmarking for individual cards/paragraphs
- Reading progress indicator and scroll restoration
- Focus/No Distraction reading mode
- Browser text-to-speech controls with voice selection

## Live site

If GitHub Pages is enabled for the repository, the site is deployed from the `main` branch by the workflow in `.github/workflows/deploy-pages.yml`.

## Project structure

```text
.
├── .github/workflows/deploy-pages.yml  # GitHub Pages deployment workflow
├── index.html                          # Static site: markup, styles, and JavaScript
└── README.md                           # Project documentation
```

## Getting started

No build step or package installation is required.

### Run locally

Open `index.html` directly in a browser, or serve the repository with any static file server:

```bash
python3 -m http.server 8000
```

Then visit <http://localhost:8000>.

## Development notes

- Keep the site dependency-light: all app code currently lives in `index.html`.
- The deployment workflow copies `index.html` into a generated `_site` directory and publishes that directory to GitHub Pages.
- Browser storage is used for user preferences such as theme, font size, bookmarks, reading position, and text-to-speech voice.
- Text-to-speech support depends on the visitor's browser and installed system voices.

## Contributing

Contributions are welcome. Good first improvements include:

- Accessibility fixes
- Responsive layout improvements
- Documentation updates
- Content corrections
- Small usability improvements for search, bookmarks, or text-to-speech

Before opening a pull request:

1. Confirm the page opens locally without console errors.
2. Test the affected feature in at least one current desktop browser.
3. Keep changes focused and describe the user-facing impact in the pull request.

## Deployment

Deployment is handled by GitHub Actions:

1. A push to `main` or a manual workflow dispatch starts the Pages workflow.
2. The workflow prepares `_site/index.html` from the repository's `index.html`.
3. The generated `_site` directory is uploaded and deployed to GitHub Pages.

## License

No license file is currently included in this repository. Until a license is added, please open an issue before reusing or redistributing the contents.
