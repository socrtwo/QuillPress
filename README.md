# QuillPress

*Part of the Quill suite: [QuillPen](https://github.com/socrtwo/QuillPen) (documents), [QuillGrid](https://github.com/socrtwo/QuillGrid) (spreadsheets), [QuillPost](https://github.com/socrtwo/QuillPost) (email), [QuillStage](https://github.com/socrtwo/QuillStage) (presentations), [QuillLoom](https://github.com/socrtwo/QuillLoom) (web sites), [QuillFolio](https://github.com/socrtwo/QuillFolio) (PDF) and **QuillPress** (desktop publishing).*

An original, open-source desktop publishing and page layout app for Android, iOS, Windows, macOS, Linux, ChromeOS and the web whose goal is the same as the rest of the Quill suite: **no missing commands**. QuillPress gives you the familiar publication workflow (frame-based pages, master pages, text that flows through linked frames and columns, paragraph, character and object styles, pictures with cropping and text wrap, shapes, tables, guides, grids, layers, spreads and bleed), opens and saves Scribus documents, and adds the best ideas from forty years of page layout software: copy fitting, autoflow, story editing, typographer's quotes, preflight, packaging, an accessibility check and an optional AI tab that can run entirely on your device. Every feature is a command, and every command can be put on the Quick Access Bar, on your own tab, on a keyboard shortcut, or in a macro, and found with command search. When a publication is damaged, QuillPress recovers what it can instead of refusing to open it.

> **Status: first working version (0.1.0, milestone M1 with much of M2–M4).** The app builds for the web, Android, iOS and desktop with the same CI and release workflows as the sister apps. What works today:
>
> - **544 commands**; 544 of the 567 ids in the plan are implemented, and the 23 reserved for later milestones are listed in [docs/COMMANDS.md](docs/COMMANDS.md). A command is registered only when it works.
> - **Layout:** pages on master pages, facing pages and spreads, margins, columns, guides, a document grid and a baseline grid; text frames with columns, insets and vertical alignment, linked into chains across pages; autoflow; overset marks; pictures with fitting, cropping, adjustments and text wrap; 90+ preset shapes; lines; tables; groups; layers; snapping and smart guides; undo/redo.
> - **Text:** an original layout engine with justification, hyphenation, drop caps, bullets and numbering, tabs with leaders, rules, keep options and baseline-grid alignment; paragraph, character and object style sheets; fields (page number, page count, section, date, variables, continued-on/from); typographer's quotes; a story editor.
> - **Files:** native .qpp (and AES-256 .qppe) and Scribus .sla open and save; text, Markdown, RTF, Word and HTML files place into frames; pictures (PNG, JPEG, GIF, WebP, BMP, TIFF, SVG) place into frames or open as pages; export to PDF (the app's own vector writer with page labels, trim box and crop marks), SVG, PNG/JPEG, a web page, text and Markdown, and a package ZIP. Damaged files go through the recovery pipeline. See [docs/FORMATS.md](docs/FORMATS.md) and [docs/RECOVERY.md](docs/RECOVERY.md).
> - **Review:** spelling in every variety of English and 90+ downloadable dictionaries, preflight, fonts and pictures panes, accessibility check, comments, reading level and statistics.
> - **AI tab** with the suite's setup wizard, on-device model and several-AI (master or Quaker consensus) modes: draft a whole publication onto laid-out pages, draft stories, headlines, decks, pull quotes, captions, rewriting, copy fitting by rewriting, alt text and layout suggestions. See [docs/AI.md](docs/AI.md).
>
> - **Layout depth:** anchored objects (inline, above the line or at a custom offset) that move with the text; footnotes set at the bottom of the column with numbering schemes, separators, endnote conversion and a Footnotes pane; text on a path (line, arcs, circle, wave, zigzag, or any shape) that prints the same way in SVG and PDF.
> - **Interchange:** InDesign IDML opens and saves with its spreads, master spreads, linked frames, stories, paragraph and character styles, swatches, layers, footnotes and pictures; Microsoft Publisher (2002–2016, and 2000 and 97/98 in part), QuarkXPress 3.1–4.1 and PageMaker 6–7 files open with their pages, frames, text formatting, shapes and pictures, read from the Document Liberation Project's descriptions of those formats; other versions and InDesign binary files open with their text and pictures; XPress Tags and FrameMaker MIF open as styled text.
> - **Typography and fonts:** optical margin alignment (hanging punctuation) per paragraph or story; footnotes in tables and in text on a path, edited in place; your own font files (.ttf, .otf, .ttc, .woff, .woff2) load into the Font box, travel inside .qpp packages and are embedded in exported PDFs.
>
> Not yet: data merge, EPUB and PDF/X output, PDF placement, QuarkXPress 5 and later, linked PageMaker threads, the layout of InDesign binary files (no public description exists; use IDML) (see [docs/FORMATS-PLAN.md](docs/FORMATS-PLAN.md) and [docs/ROADMAP.md](docs/ROADMAP.md)). PDF export embeds the publication's fonts as subsets; fonts it cannot embed (WOFF2, restricted licenses, unbundled system fonts) print in the closest standard face. The Publisher, QuarkXPress and PageMaker readers have been run against files saved by those programs (three Publisher 2007 files and the Document Liberation Project's seed corpora: 31 Publisher, 163 QuarkXPress and 27 PageMaker files) and compared page by page with LibreOffice's import of the same files; see [docs/FORMATS.md](docs/FORMATS.md) for what each reads, where it differs from the reference and what it still misses. PDF export is checked with poppler and pypdf; the Scribus and IDML readers and writers are tested on files built in code, not yet against those programs themselves.

## Features and plan

- **A complete command set.** Every command a desktop page layout program offers, tab by tab (File, Home, Insert, Page Design, Text, Arrange, Review, View, Tools, AI, Developer, Help, and the contextual Master Page, Text Frame, Picture, Shape, Line, Table Design and Table Layout tabs), plus commands adopted from other publishing tools. See [docs/COMMANDS-PLAN.md](docs/COMMANDS-PLAN.md).
- **No missing commands.** Commands are data. The ribbon, the Quick Access Bar, custom tabs, context menus, keyboard shortcuts, macros and command search (Alt+Q) all refer to command ids, so anything QuillPress can do can be placed anywhere, including the 163 commands kept out of the default tabs.
- **Quick Access Bar** with the full desktop drop-down checklist (AutoSave, New, Open, Save, Email, Quick Print, Print Preview and Print, Spelling, Undo, Redo, Preview, Touch/Mouse Mode, Open Recent File) and **Add All Choices**, which puts Save and Print first and everything else in alphabetical order. The bar can sit at the top or at the bottom near the keyboard. See [docs/QAT.md](docs/QAT.md).
- **Customize Tabs and Keyboard:** create tabs and groups, put any command in them, rename, reorder or hide built-in tabs, and rebind any command with conflict display. Layouts can be exported and imported.
- **Innovations from other publishing software:** autoflow and linked frames, master pages with overrides, copy fitting by type scale and by rewriting, a story editor, paragraph rules and drop caps, typographer's quotes, text variables, step and repeat, paste in place, layout guides, baseline grids, preflight, packaging with a report, a print checklist and booklet order, pasted-text clean-up, and more. Each idea is credited in [docs/INNOVATIONS.md](docs/INNOVATIONS.md).
- **Templates** built in code from the default styles: newsletter, trifold brochure, flyer, poster, business card, invoice, menu, résumé, booklet, postcard and report, plus your own saved templates.
- **Export** to PDF with bleed and crop marks, SVG, PNG and JPEG per page, a self-contained web page with the stories as flowing text for phones and screen readers, text and Markdown of all stories, a Scribus document, and a package ZIP with every picture and a report for the printer.
- **AI tab (optional).** Draft a publication from a brief and have it laid out on pages, draft and rewrite stories, suggest headlines, decks and pull quotes, write captions and alt text, fit copy by rewriting, and get layout suggestions. A setup wizard covers free and paid providers, local servers, and a **free on-device model** that needs no account and works offline after one download. Several AIs can work on one request: one AI combines the others' answers, or they deliberate Quaker-style until they agree. Nothing is sent anywhere until you run an AI command.
- **Spelling in many languages.** Offline dictionaries for every variety of English, and a **Spelling Dictionaries** wizard that downloads freely licensed dictionaries for 90+ other languages when you need them.
- **Corrupt-file recovery.** Damaged .qpp, .sla and .json files go through a recovery pipeline descended from the author's [Immortal Unzipper / Immortal Zip](https://socrtwo.github.io/Immortal-Zip/) and [Word Recovery](https://github.com/socrtwo/wordrecovery-SF) tools: file identification from the bytes, byte-level ZIP salvage, JSON and XML repair, picture harvesting and text scans. The recovered publication opens as a new, unsaved file with a report.

## File formats

| Format | Open | Save | Notes |
|---|---|---|---|
| QuillPress publication (.qpp) and encrypted (.qppe) | Yes | Yes | Native ZIP package (JSON + pictures); AES-256 for .qppe |
| Scribus document (.sla) | Yes | Yes | Scribus 1.4 and 1.5 XML: pages, masters, linked frames, styles, colors, embedded pictures |
| InDesign Markup (.idml) | Yes | Yes | Spreads, master spreads, linked frames and stories, styles, swatches, layers, sections, footnotes; pictures embedded on save |
| XPress Tags (.xtg), FrameMaker MIF (.mif) | Yes | No | Styled text; MIF also pages, text flows and variables |
| Publisher (.pub) | Yes | No | Pages, masters, frames, text formatting, tables, shapes, WordArt as text, fills, pictures (2002–2016; 2000 and 97/98 in part) |
| QuarkXPress (.qxp .qxd .qxt) | Yes for 3.1–4.1 | No | Pages, masters, chained text boxes, formatting, shapes, gradients, groups, text paths; pictures when embedded; other versions give text and pictures |
| PageMaker (.pmd .p65 .pm6 .pmt) | Yes for 6–7 | No | Pages, text blocks, formatting, shapes, groups, placed TIFFs; earlier versions give text and pictures |
| InDesign binary (.indd) | Text and pictures | No | No public description of the layout; save as IDML from InDesign instead |
| QuillPress JSON (.json) | Yes | Yes | The publication as plain JSON |
| Text, Markdown, Rich Text, Word, HTML (.txt, .md, .rtf, .docx, .html) | Place or open | Text and Markdown export | Headings and lists become paragraph styles |
| Pictures (.png, .jpg, .gif, .webp, .bmp, .tif, .svg) | Place or open | SVG, PNG, JPEG export | TIFF is decoded in the app |
| PDF | No (planned) | Yes | Vector graphics, text in the publication's fonts embedded as subsets, page labels, trim and bleed boxes, crop marks |
| HTML | Place | Yes | One self-contained page with every publication page as vector graphics |
| Package (.zip) | No | Yes | .qpp, .sla, PDF, web page, every picture and a report |

## Platforms

Each release has builds for:
- **Android** (APK and AAB);
- **iOS/iPadOS** (an unsigned .ipa you sign with your Apple ID);
- **Windows** (installer for x64 or ARM, or portable);
- **macOS** (universal);
- **Linux** (AppImage or .deb for x64, arm64 and armv7l, which covers **Raspberry Pi OS**);
- **ChromeOS** (Android app, Linux app or web app);
- the **web** (static files; offline-capable and installable).

On Android, QuillPress registers for *Open with* and *Share to* on publication, text and picture files and uses the system file picker, so files on the device, SD card and cloud providers all work. **Save** writes back to the same file.

CI type-checks, tests and builds the web app and an APK on every push, and a **Release** workflow builds every platform and publishes them together from a tag `v*`, a manual run, or a `[release]` commit, as in the sister apps. See [docs/BUILD.md](docs/BUILD.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/ROADMAP.md](docs/ROADMAP.md).

## The Quill suite

| App | What it is | Repository |
|---|---|---|
| **QuillPen** | Word processor | https://github.com/socrtwo/QuillPen |
| **QuillGrid** | Spreadsheet | https://github.com/socrtwo/QuillGrid |
| **QuillPost** | Email | https://github.com/socrtwo/QuillPost |
| **QuillStage** | Presentations | https://github.com/socrtwo/QuillStage |
| **QuillLoom** | Web sites | https://github.com/socrtwo/QuillLoom |
| **QuillFolio** | PDF viewing, editing, forms, signing, OCR and repair | https://github.com/socrtwo/QuillFolio |
| **QuillPress** | Desktop publishing and page layout (this project) | https://github.com/socrtwo/QuillPress |

The apps share one application shell: the command registry, Quick Access Bar, customizable tabs and keyboard, command search, macro recorder, AI setup wizard and providers, spelling dictionaries, recovery engine and platform layer. QuillPress places documents written in QuillPen, hands its PDFs to QuillFolio, and shares publications through QuillPost.

## Documentation

| File | Contents |
|---|---|
| [docs/INNOVATIONS.md](docs/INNOVATIONS.md) | Survey of page layout software, past and present, and what QuillPress adopts from each |
| [docs/QAT.md](docs/QAT.md) | The Quick Access Bar and the drop-down choices by version |
| [docs/COMMANDS-PLAN.md](docs/COMMANDS-PLAN.md) | The planned command inventory, tab by tab, with command ids |
| [docs/COMMANDS.md](docs/COMMANDS.md) | Every command the app ships (generated) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Source layout as built: shell, publication model, text flow, rendering, export, recovery |
| [docs/ARCHITECTURE-PLAN.md](docs/ARCHITECTURE-PLAN.md) | The design the code follows and what is still planned |
| [docs/FORMATS.md](docs/FORMATS.md) | What opens and saves today, and how |
| [docs/FORMATS-PLAN.md](docs/FORMATS-PLAN.md) | Every page layout format to open eventually, with honest status |
| [docs/RECOVERY.md](docs/RECOVERY.md) | Recovering damaged publications |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Milestones |
| [docs/AI.md](docs/AI.md), [docs/ENSEMBLE.md](docs/ENSEMBLE.md) | The AI tab; several AIs on one request |
| [docs/BUILD.md](docs/BUILD.md), [docs/INSTALL.md](docs/INSTALL.md), [docs/ANDROID.md](docs/ANDROID.md) | Building, installing, the Android app |
| [docs/LEGAL.md](docs/LEGAL.md) | Clean-room, trademark and licensing notes |

## Project language

The interface, code comments and documentation use American English. Spelling checks accept every variety of English by default.

## License

[MIT](LICENSE). Copyright (c) 2026 Paul D Pruitt.

## Legal

QuillPress is an independent, clean-room project released under the MIT License. It is not affiliated with, endorsed by, or sponsored by Adobe, Quark, Microsoft, Serif, Canva, the Scribus team, any AI provider, or any other vendor. Product names appear only to describe file-format compatibility or the origin of an idea (nominative use). InDesign and PageMaker are trademarks of Adobe Inc.; QuarkXPress is a trademark of Quark Software Inc.; Microsoft Publisher is a trademark of Microsoft Corporation; other names belong to their owners. The interface, icons, templates and text are original or openly licensed. See [docs/LEGAL.md](docs/LEGAL.md).
