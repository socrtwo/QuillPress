# Architecture

QuillPress is a TypeScript web application built with **Vite** and tested with **vitest** and **Playwright**. The Android and iOS releases package it with **Capacitor 8**, the Windows, macOS and Linux releases with **Electron**, and the same build is a PWA. It shares its application shell with the other Quill apps.

## Source layout

```
src/
  main.ts                 entry: fonts, command registry, App + Shell, launch files, drafts toast, back button
  app.ts                  App (publication tabs, exec(), macro recording, autosave) and PubTab (publication + view state)
  prefs.ts                per-device preferences: QAT (QAT_STANDARD, QAT_EXTRAS, addAllQatChoices), custom tabs,
                          keymap, macros, AutoCorrect, units, snapping, guides and grids, display options
  templates/              original templates built in code (index.ts) and placeholder text (lorem.ts)
  model/
    types.ts              Publication data: pages, masters, items (text frames, pictures, shapes, lines, tables,
                          groups), stories (paragraphs/runs), styles, swatches, layers, sections, variables
    pub.ts                Pub with transactions and before-image undo/redo (page-scoped), media, lookups, JSON
    styles.ts             default styles and swatches, color and font schemes, style resolution, color names
    geometry.ts           preset shapes (original drawings) and custom paths
    pathGeom.ts           SVG path parsing, arcs to curves, flattening, arc-length walking (text on a path, PDF)
  render/
    text.ts               the text layout engine: measure, lines, justification, hyphenation, drop caps,
                          bullets and numbering, tabs, baseline grid, fields
    flow.ts               frames → column boxes, wrap exclusions, story layout through a chain, overset
    page.ts               the one page renderer: SVG for the editor, thumbnails, print and export
    pathText.ts           glyph placement along a path (pathTextGlyphs: shared by the SVG renderer and the PDF writer)
    table.ts              tableLayout: cells, note area and total height, shared by the renderer and the PDF writer
  edit/
    workspace.ts          the tab view: pages rail, rulers, single page or spread canvases, preview mode
    canvas.ts             selection, move/resize/rotate, snapping and smart guides, drawing tools, link ports,
                          drag-and-drop pictures, context menus
    textEdit.ts           in-place editing (a contenteditable island bound to the story)
    ops.ts                transactions on the current page or master, inserting, formatting, linking, arranging
    flowOps.ts            autoflow: new linked frames and pages until a story fits
  commands/               every command, by area (file, edit, view, fmt, insert, page, text, notes, anchor, pathText,
                          arrange, shape, picture, table, review, tools, importLayout, ai, dev, help); index.ts loads them all
  io/
    index.ts              FORMATS, sniffFormat, importPublication / exportPublication (lazy readers, recovery)
    qpp.ts                .qpp (ZIP), .json, .qppe (AES-256-GCM)
    sla.ts                Scribus import and export
    idml.ts, idmlText.ts  InDesign IDML import (designmap, spreads, master spreads, stories, styles, colors)
    idmlExport.ts, idmlExportText.ts   IDML export (the inverse: package, spreads, items, styles, stories, footnotes, tables)
    mspub.ts, mspub/      Microsoft Publisher: compound-file streams, Contents chunks, Quill text, Office Art shapes
                          and pictures, layout assembly (2002–2016, 2000, 97/98); cfb.ts the compound-file reader
    qxp/, pagemaker/      QuarkXPress 3.1–4.1 and PageMaker 6–7 layout readers (blocks/records, objects, text)
    legacyLayout.ts       dispatch and the fallback: text runs and pictures recovered from the bytes (INDD, other versions)
    xpressTags.ts, mif.ts XPress Tags and FrameMaker MIF readers
    textImport.ts         text, Markdown, RTF, Word and HTML → paragraphs
    images.ts, tiff.ts, png.ts   pictures: type, size, TIFF → BMP, PNG decoding without a canvas
    xml.ts                XML helpers, base64
    recover/              fileid (identification), inflate (ImmortalInflate), salvage (ZIP), index (methods)
  export/
    pdf.ts                the vector PDF writer (embedded font subsets, pictures, boxes, labels, marks, path text)
    fonts/                WOFF → TrueType, TrueType/OpenType parsing and subsetting, user font files, CID font embedding
    images.ts             SVG with embedded fonts; PNG/JPEG rasterization
    html.ts               web page export; text and Markdown of the stories
    print.ts              print sheets, preview dialog, crop marks, spreads
  proof/                  spelling: dictionaries (downloads), proofing (targets, worker protocol), worker
  ai/                     providers, client, store, ensemble (shared); press.ts (QuillPress prompts)
  ui/                     shell (ribbon, QAT, tabs, status bar, context menus), dialogs, panes, backstage,
                          customize dialogs, AI and dictionary wizards, recovery report, fonts dialog
  platform/native.ts      files, sharing, printing, clipboard, sibling apps (browser, Capacitor, Electron)
  util/                   keys, store (IndexedDB), crypto, sanitize
  styles/                 app.css (shell, shared) and press.css (workspace, overlay, editor)
```

## Model

A `Publication` is pages built on masters. Every object on a page is an **item** with a kind (`text`, `picture`, `shape`, `line`, `table`, `group`) and common fields (box, rotation, flips, layer, lock, wrap, alt text, link, object style, fill, line, effects, opacity). Text lives in **stories**: a story is an array of paragraphs (style name plus overrides, runs with character overrides, fields and breaks); a text frame shows a story and names the previous and next frame of its chain. Styles (`para`, `char`, `object`) are named and resolved through `basedOn` chains (`resolvePara`, `resolveRun`); an item or paragraph records only its overrides. Colors are hex values or swatch names resolved at render time, so a scheme change recolors everything.

`Pub.transact(label, fn, pages?)` runs one undoable step: it keeps a before-image of the named pages (and the stories), or of the whole publication, compares after, and pushes an undo entry only when something changed. Commands never mutate the model outside a transaction.

## Text flow and rendering

`render/flow.ts` turns a frame into column boxes (insets, columns, gutter) and collects **wrap exclusions** from objects above it in z-order (and on the master). `storyLayout` lays the story's paragraphs through every box of its chain with `render/text.ts`, which measures with a canvas (`measureText`, cached per font) and breaks lines with justification, hyphenation points, drop caps, bullets, tabs, keep options and baseline-grid snapping. The result is a list of laid lines with segments; the last box reports **overset** text. Layouts are cached per `pub.version`.

`render/page.ts` draws a page (or master) as SVG: master items under page items, backgrounds, pictures (clipped by crop and geometry), shapes, lines with arrowheads, tables, text lines as `<tspan>`s, fields resolved per page, overset marks, and in edit mode the margins, columns, guides, bleed, grids and frame edges. The same function feeds the editor, the thumbnails, printing and every export, so what you see is what you get.

## Editing

`Workspace` mounts a pages rail (thumbnails, drag to reorder, masters) and one or two `Canvas` instances (spread view). The canvas renders the page SVG, draws a selection overlay with handles and link ports, and handles pointer input: move, resize, rotate, marquee, pinch zoom, drawing tools (frames, shapes, tables, guides), linking, drop of pictures, and keyboard navigation. Double-clicking a text frame opens a `TextEditor`: a contenteditable island positioned over the frame, rendered from the story and read back into paragraphs on commit, with typographer's quotes, AutoCorrect, automatic lists and next-style on Enter. Commits are transactions.

## Commands and shell

Every feature is a `def()` in `src/commands/*.ts` with an id (`area.name`), label, icon, tab and group. `App.exec` checks read-only state and `isEnabled`, records macros, remembers the last command for Repeat and reports errors as toasts. The shell (`src/ui/shell.ts`) renders tabs and groups from `ribbonLayout.ts` (built-in tabs, contextual tabs for the selected object kind and master editing, custom tabs), the Quick Access Bar, the status bar (page, position and size in the user's unit, views, zoom), context menus, panes, the backstage and the command palette. `docs/COMMANDS.md` is generated from the registry and checked by a test.

## Files, recovery, export

`importPublication` sniffs the format, runs the reader, and on failure runs the recovery pipeline ([RECOVERY.md](RECOVERY.md)); `exportPublication` writes the native and Scribus formats. Exports that are not publication formats (PDF, pictures, web page, text, package) live in `src/export/` and are reached from the backstage. See [FORMATS.md](FORMATS.md).

## Platforms

`platform/native.ts` abstracts the file system (File System Access API, Capacitor plugin `QuillNative`, Electron bridge), sharing, printing, the clipboard, secure storage and the sibling Quill apps. The Android project (`android/`), the iOS project (`ios/`) and the Electron main process (`electron/`) are committed; `scripts/` holds icon generation, notices and the catalog. See [BUILD.md](BUILD.md), [ANDROID.md](ANDROID.md) and [INSTALL.md](INSTALL.md).

## Tests

- `tests/unit/model.test.ts`: model, styles, transactions, labels, JSON, geometry, renderer, templates.
- `tests/unit/flow.test.ts`: line breaking, overset, column boxes, autoflow, wrap exclusions.
- `tests/unit/io.test.ts`: formats, .qpp/.qppe/.json round trips, Scribus export and import, text and picture import, PDF, web page, text export.
- `tests/unit/recover.test.ts`: identification and every recovery method on files damaged in code.
- `tests/unit/commands.test.ts`: the registry, panes, text helpers, find, print sheets, AI parsing, proofing.
- `tests/unit/catalog.test.ts`: ribbon, backstage and QAT ids exist, `COMMANDS.md` is current, plan coverage, Add All order.
- `tests/e2e/smoke.mjs`: Playwright against the production build: typing, formatting, undo/redo, drawing, pages, masters, spreads, autoflow, round trips, PDF export, panes.
