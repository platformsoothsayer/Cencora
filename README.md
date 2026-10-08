# Hotline Email Processing demo

Sales demonstration of a pipeline that turns vendor hotline email into rows in
`raw_VendorEmailProcessing`. Next.js App Router, TypeScript, Tailwind, Recharts.
No backend: `data/cencora-demo-seed.json` is imported at build time and parsed in
the browser, deterministically.

## Run

```
npm install
npm run dev               # http://localhost:3000
npm run build && npm start
npm run check:extract     # prints every extraction, field by field
```

## Deploy

```
npx vercel --prod
```

## Where things are

- `lib/extract.ts`: the parser. Per-vendor templates, the fallback extractor for
  template drift, normalization against `priority_map`, `status_map` and the site master.
- `lib/pipeline.ts`: run order, run summaries, ticket grouping, issue categories.
- `components/PipelineState.tsx`: session state shared across pages (live runs, reprocess).
- `app/*/page.tsx`: the eight pages.

## Corpus outcome

46 read, 43 loaded, 2 held (template drift, unreadable PDF), 1 rejected (non-vendor
sender). Reprocessing the drifted Dematic message on the monitoring page loads it at
0.55 confidence, giving 44 rows.
