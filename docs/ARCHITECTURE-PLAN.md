# Architecture plan

The design QuillPress was built to, and what remains. [ARCHITECTURE.md](ARCHITECTURE.md) describes the code as it is; this file keeps the intent and the parts not built yet, so the two can be compared.

## Summary

QuillPress is a TypeScript web application built with **Vite** and tested with **vitest**; Capacitor 8 packages it for Android and iOS, Electron for the desktop, and the build is a PWA. It reuses the Quill suite shell unchanged wherever it can (registry, ribbon, QAT, customize dialogs, command search, macros, AI providers and wizard, dictionaries, recovery engine, platform layer) and adds a frame-based publication model, a text layout engine, an SVG page renderer, a canvas editor and its own exporters.

## Design decisions

- **Frames, not a flow.** Unlike a word processor, nothing on a page moves unless you move it; text flows only inside the chain of frames you link. A text frame shows a story; a story can span any number of frames on any pages.
- **One renderer.** The editor, thumbnails, print and every export draw through `render/page.ts`, so output matches the screen. The renderer is pure (publication in, SVG out) and runs in Node for tests.
- **Points everywhere.** The model stores points; units are a display preference. Facing pages swap inside and outside margins at layout time.
- **Styles first.** Paragraph, character and object styles are the normal way to format; local overrides are kept separate so Redefine Style and Clear Formatting work.
- **Commands are data.** No feature exists outside the registry; the ribbon is a layout of ids.
- **Own exporters.** The PDF writer, the SVG/PNG export and the Scribus reader/writer are original code with no proprietary dependencies, and the PDF stays vector with selectable text.
- **Recovery before refusal.** A damaged file opens with a report rather than an error.

## Built (0.1.0)

Everything in [ARCHITECTURE.md](ARCHITECTURE.md): model with transactions, text engine with justification and hyphenation, flow through chains with wrap exclusions and autoflow, SVG renderer, workspace with pages rail, rulers, spreads and preview, canvas editing with snapping and tools, in-place text editing, 500+ commands across 12 tabs and 7 contextual tabs, panes, templates, .qpp/.qppe/.json/.sla, text and picture placement, PDF/SVG/PNG/JPEG/HTML/text/package export, print, recovery, spelling, AI tab, Android, iOS and desktop projects, CI and release workflows.

## Planned

| Area | Plan | Milestone |
|---|---|---|
| Text engine | Knuth–Plass paragraph breaking as an option; optical margin alignment; OpenType feature switches; vertical text in the engine (today the frame rotates) | M4 |
| Flow | Anchored objects that travel with their text; footnotes; text on a path; keep-with-next across frames | M4 |
| Model | Alternate layouts; liquid layout rules; multi-page spreads | M5 |
| Pictures | Clipping paths from alpha for tight wrap; color profiles; user fonts from files | M4 |
| Formats | IDML, Publisher, MIF import; PDF placement; EPUB and PDF/X export; data merge from CSV | M5 |
| Review | Track changes in stories; visual compare | M6 |
| Suite | Place QuillPen documents with styles mapped; send PDFs to QuillFolio; charts from QuillGrid | M6 |
| Platform | External font folders on the desktop; printing with printer marks through the OS dialog | M5 |

See [ROADMAP.md](ROADMAP.md) for the order.
