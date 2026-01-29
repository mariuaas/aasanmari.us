# aasanmari.us

Personal website built with Astro + Tailwind (via Vite) and authored with Markdown.

## Stack

- Astro (static output)
- Tailwind CSS
- Markdown math support via `remark-math` + `rehype-katex`
- Bun for running scripts

## Quick start

```bash
bun install
bun run dev
```

Open http://localhost:4321

## Commands

```bash
bun run dev       # local dev server
bun run build     # production build to dist/
bun run preview   # preview the production build
```

## Editing content

### Homepage / Blog

The homepage is the blog landing page:

- `src/pages/index.astro`
- Blog posts live in `src/content/blog/` (Markdown)

Individual posts are routed at `/blog/<slug>`.

### Papers

- Page: `src/pages/papers.md`
- BibTeX files: `public/bib/*.bib` (linked from the papers page as `/bib/<file>.bib`)

### CV

- Page: `src/pages/cv.md`

### Layout / styling

- Site layout: `src/components/BaseLayout.astro`
- Markdown page wrapper layout: `src/layouts/MarkdownLayout.astro`
- Global styles + theme tokens: `src/styles/global.css`

## Deploy

This is a static site. Deploy the contents of `dist/` to your host of choice after running:

```bash
bun run build
```
