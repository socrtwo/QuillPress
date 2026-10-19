# QuillFolio

*Part of the Quill suite: [QuillPen](https://github.com/socrtwo/QuillPen) (documents), [QuillGrid](https://github.com/socrtwo/QuillGrid) (spreadsheets), [QuillPost](https://github.com/socrtwo/QuillPost) (email), [QuillStage](https://github.com/socrtwo/QuillStage) (presentations), [QuillLoom](https://github.com/socrtwo/QuillLoom) (web authoring), [QuillPress](https://github.com/socrtwo/QuillPress) (desktop publishing), and QuillFolio (PDF).*

QuillFolio is an original, open-source PDF app for Android, iOS, Windows, macOS, Linux, ChromeOS and the web. Its goal is the same as the rest of the Quill suite: **no missing commands**. It provides the familiar office-suite document workflow plus the best ideas from current and former PDF software, past and present.

> **Status: planning. There is no code yet.** This repository holds the plan only.

## Features and plan

- **A complete command set.** Every command a modern PDF tool offers, patterned after Microsoft Office and the rest of the Quill suite: File, Home, Edit, View, Comment, Forms, Protect, Sign, Organize Pages, Scan/OCR, Review, Share, Help.
- **No missing commands.** Commands are data. The ribbon, Quick Access Bar, custom tabs, context menus, shortcuts, macros and command search (Alt+Q) all refer to command ids.
- **History of PDF software.** Create, open, annotate, redact, sign, compare, OCR, optimize, compress, linearize, repair, inspect structure, reorder pages, rotate, split, merge, extract, convert, create forms, fill forms, certify, measure, preflight, accessibility check, Bates numbering, bookmarks, attachments, multimedia, layers, signatures, and portfolio support.
- **Corrupt-file repair.** Damaged PDFs go through a recovery pipeline descended from the author's XML Truncator-Fixer and Immortal Zip projects. Repair covers xref tables, object streams, truncated EOF markers, broken page trees, damaged embedded files, and partial recovery of zip-based PDF portfolios and hybrid office outputs. See docs/REPAIR.md.
- **AI tab (optional).** The suite's setup wizard, on-device model, and several-AI modes: summarize, explain, extract table data, answer questions, suggest redactions, generate alt text, classify fields, rewrite OCR text, and translate.
- **Original ideas.** A repair diff, a plain-language accessibility fixer, redaction audit trails, compare-as-you-type, live form assistance, page-rotation inference, document similarity search, and export-ready review packages. See docs/INNOVATIONS.md.

## Platforms (planned)

Android, iOS/iPadOS, Windows, macOS, Linux (including Raspberry Pi OS), ChromeOS and the web, with the same stack and CI/release workflows as QuillStage (TypeScript, Vite, Capacitor, Electron).

## Documentation

| File | Contents |
|---|---|
| [docs/INNOVATIONS.md](docs/INNOVATIONS.md) | Survey of PDF software and what QuillFolio adopts |
| [docs/COMMANDS-PLAN.md](docs/COMMANDS-PLAN.md) | Planned command inventory by tab |
| [docs/ARCHITECTURE-PLAN.md](docs/ARCHITECTURE-PLAN.md) | Shell, PDF model, annotations, forms, export, AI, recovery, builds |
| [docs/FORMATS-PLAN.md](docs/FORMATS-PLAN.md) | Formats to open and save |
| [docs/REPAIR.md](docs/REPAIR.md) | PDF corruption repair design |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Milestones |
| [docs/LEGAL.md](docs/LEGAL.md) | Clean-room, trademark and licensing notes |

## License

[MIT](LICENSE). Copyright (c) 2026 Paul D Pruitt.

## Legal

QuillFolio is an independent, clean-room project. It is not affiliated with, endorsed by, or sponsored by Adobe, Foxit, Nitro, PDF-XChange, Apple, Google, or any other vendor named in the docs. Names are used only to describe compatibility and history.
