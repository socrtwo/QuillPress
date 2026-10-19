# Roadmap

> **Status (0.1.0):** M0 and M1 are done; parts of M2–M4 are done as noted below, and [COMMANDS.md](COMMANDS.md) lists every planned command not yet implemented. Milestones are ordered by dependency, not by date.

## M0 — Planning (done)

- [x] README, feature survey ([INNOVATIONS.md](INNOVATIONS.md)), Quick Access Bar plan ([QAT.md](QAT.md)), command inventory ([COMMANDS-PLAN.md](COMMANDS-PLAN.md)), architecture plan ([ARCHITECTURE-PLAN.md](ARCHITECTURE-PLAN.md)), formats plan ([FORMATS-PLAN.md](FORMATS-PLAN.md)), legal notes ([LEGAL.md](LEGAL.md)).
- [ ] Collect a corpus of openly licensed test publications (.sla from several Scribus versions, .idml, .pub).

## M1 — Shell and model (done)

- Project scaffold: TypeScript, Vite, vitest, Playwright, Capacitor 8 (Android, iOS), Electron, PWA manifest and service worker; CI and Release workflows from the sister apps.
- Shared shell: command registry, ribbon with contextual tabs, Quick Access Bar with the full drop-down and **Add All Choices**, Customize Tabs, Customize Keyboard, command search, Backstage, preferences, macros, panes.
- Publication model with transactions and undo/redo; masters, pages, spreads, styles, swatches, layers, sections, variables.
- Text layout engine; stories flowing through linked frames; autoflow; overset marks.
- Workspace: pages rail, rulers, single page and spreads, preview; canvas editing with snapping, tools, link ports; in-place text editing.
- Native .qpp save and open; autosave drafts, crash recovery, version history and snapshots.
- A catalog test that compares the registry with COMMANDS-PLAN.md and reports missing commands.

## M2 — Files and output (done except where noted)

- [x] Scribus .sla open and save with chains, styles, colors and embedded pictures.
- [x] Text, Markdown, RTF, Word and HTML placement; pictures incl. TIFF and SVG.
- [x] PDF export (own writer), SVG/PNG/JPEG, web page, text/Markdown, package ZIP; print with crop marks and spreads.
- [x] Recovery pipeline for .qpp, .sla and .json; manual recovery for any file.
- [ ] Gzip-compressed .sla.gz; Scribus table cell text; verification against Scribus 1.5/1.6 itself.

## M3 — Typography and review (mostly done)

- [x] Paragraph, character and object style sheets with redefine, duplicate, delete with replacement, load from another publication.
- [x] Hyphenation, justification, drop caps, rules, tabs with leaders, keep options, baseline grid, tracking, kerning, ligatures, small caps, baseline shift.
- [x] Spelling with the suite's dictionaries; statistics; reading level; preflight; accessibility check; comments; fonts and pictures panes.
- [ ] .doc and .odt placement; language-specific hyphenation patterns beyond the heuristic breaker.

## M4 — Layout depth

- [x] Templates (newsletter, brochure, flyer, poster, business card, invoice, menu, résumé, booklet, postcard, report); color and font schemes; layout guides; step and repeat; paste in place; master item overrides.
- [ ] Anchored objects; footnotes; text on a path; optical margin alignment; OpenType features; user fonts from files; clipping paths for tight wrap.

## M5 — Interchange

- [ ] IDML import (then export); Microsoft Publisher import; FrameMaker MIF; QuarkXPress tags; PDF placement; EPUB and PDF/X export; data merge.

## M6 — Collaboration and suite

- [ ] Track changes; visual compare; shared comments; QuillPen documents with mapped styles; charts from QuillGrid; PDF hand-off to QuillFolio with form fields kept.

## Always

- Keep the shared shell in step with the sister apps; port fixes both ways.
- Every new feature is a command; the catalog stays current (`npm run catalog`).
