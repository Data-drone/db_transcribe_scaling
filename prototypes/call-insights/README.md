# Call Insights — local investigation prototype

Red and black interactive redesign based on the [UI journey review](../../docs/ui-journey-review.md). The primary journey is Overview → filtered conversations → timestamped transcript evidence → saved investigation.

```bash
cd prototypes/call-insights
npm ci
npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

Open <http://127.0.0.1:5174/#/overview>. `npm run build` checks TypeScript and creates the static build; `npm run lint` checks source.

- **Overview:** KPIs, daily volumes, reasons and suggested patterns use the same queue/period-filtered fixtures as Explore. The default 16–22 October snapshot contains 9 calls; the 30-day window contains 10. No invented previous-period comparisons.
- **Explore:** exact transcript/summary search, URL filters, stable paging, related excerpts and timestamp links. Opening a call preserves the complete results URL.
- **Call review:** searchable transcript, keyboard-accessible turns, key moments, seek/speed controls and synthetic browser text-to-speech. This reads fixture text; original recordings are unavailable, and timing is approximate. Spoken account-number fixtures are hidden in display/search.
- **Investigations:** save one or more transcript turns with an analyst note, create/rename cases, reopen sources, copy local links and export a Markdown brief. Cases persist in this browser's localStorage; the UI reports when storage is unavailable. A link does not transfer case data or grant permissions.
- **Experiments:** Labels and Ask remain explicitly simulated, using hand-authored fixtures rather than live model results. Label edits reset on reload.

All data is fictional HarperValleyBank-style scenario data. The fixed snapshot ends 22 October 2026. There is no warehouse, model endpoint, authentication or production masking service behind this prototype. Layout supports desktop and mobile, visible keyboard focus, reduced-motion preferences and native modal focus handling.

The Databricks implementation in [apps/call-insights](../../apps/call-insights/README.md) is a separate application. This change is confined to the local prototype.

See [redesign notes](docs/redesign.md) for review coverage and validation.
