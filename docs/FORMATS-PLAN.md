# File formats plan

Every page layout format QuillPress intends to recognize, current and historical, with honest status. [FORMATS.md](FORMATS.md) describes what works today. Files are identified by content (`src/io/recover/fileid.ts`), so the plan lists the signatures too.

| Format | Extensions | Signature | Status | Plan |
|---|---|---|---|---|
| QuillPress publication | .qpp .qppe .json | ZIP with `mimetype` = `application/x-quillpress`; `QFDE1`; JSON with `"format":"quillpress"` | **Open and save** | — |
| Scribus | .sla, .sla.gz | XML `<SCRIBUSUTF8NEW` (1.3+) or `<SCRIBUSUTF8` (1.2) | **Open and save** (1.4, 1.5) | Gzip-compressed .sla.gz; 1.2 files; tables' cell text; text on path as a path |
| Microsoft Publisher | .pub | Compound file (OLE2) with a `Quill` stream | **Text and pictures** | No public specification exists for Publisher's structures (the Microsoft Open Specifications cover the container, [MS-CFB], and the drawing records, [MS-ODRAW], which QuillPress uses). Layout, frames and styles would need a clean-room reconstruction of the `Contents` stream; not planned until a source exists |
| InDesign Markup | .idml | ZIP with `designmap.xml` and `mimetype` = `application/vnd.adobe.indesign-idml-package` | **Open** (spreads, masters, frames, chains, stories, styles, colors, layers, sections, variables; linked pictures by name) | Save as IDML; anchored objects as anchors; tables as tables; effects |
| InDesign binary | .indd .indt | GUID header `0606EDF5-D81D-46E5-BD31-EFE7FE74B71D` | **Text and pictures** | Identification and harvest only; the app points to IDML export |
| QuarkXPress | .qxp .qxd .qxt | `MMXPR3` (Mac) / `IIXPR3` (Windows) header at offset 2 | **Text and pictures** | A layout reader only if a public specification or a permissively licensed reference appears |
| QuarkXPress Tags / XPress Tags | .xtg | Text starting with `<v6.00><e0>` (version, encoding) | **Open** (style sheets, paragraphs, character formatting) | Place into an existing frame; export as XPress Tags |
| PageMaker | .pmd .p65 .pm6 .pmt | `00 00 FF FF` / `FF FF 00 00` + `PageMaker` in the header | **Text and pictures** | — |
| FrameMaker MIF | .mif | Text starting `<MIFFile` | **Open** (pages, text rectangles, flows, paragraph formats, inline fonts) | Tables, anchored frames, graphics, master pages, variables |
| FrameMaker binary | .fm .book | `<MakerFile` | Not yet | Identification and harvest |
| Ventura Publisher | .chp .vp | Text chapter files with `@` tags; `.vp` binary | Not yet | Tagged text import (`@HEADLINE = …`) |
| Affinity Publisher | .afpub | Binary; identification by name | Not yet | Identification only (no public specification) |
| Microsoft Word | .docx .doc .odt | OOXML, OLE2, ODF | .docx places as text | .doc and .odt text placement (M3) |
| PDF | .pdf | `%PDF-` | Export only | M5: place PDF pages as pictures (rendered through QuillFolio's engine), import text with positions |
| EPUB | .epub | ZIP with `mimetype` = `application/epub+zip` | Not yet | M5: reflowable export from stories and styles |
| PostScript / EPS | .ps .eps | `%!PS` | Not yet | Identification; place EPS preview (TIFF/WMF header) as a picture |
| PNG, JPEG, GIF, WebP, BMP, TIFF, SVG | — | by signature | **Place and open** | HEIC/AVIF where the platform decodes them |
| Pictures: Photoshop, Illustrator | .psd .ai | `8BPS`; `%PDF-` or `%!PS` | Not yet | PSD composite image; AI as PDF |
| Fonts | .ttf .otf .woff2 | by signature | Bundled set only | User fonts loaded from files (M4, FontFace API) |

## Identification

`src/io/recover/fileid.ts` identifies a file from its bytes (ZIP, OLE2, XML, JSON, text, pictures, PDF, archives) before any reader runs, and reports when the name and the content disagree. For formats QuillPress cannot open, the recovery dialog names the format, harvests pictures and text, and points to the S2 online tools that can.

## Priorities

1. **Scribus** stays the open interchange format: anything another program can save as .sla reaches QuillPress.
2. **IDML** (Adobe's documented package) and **XPress Tags** and **MIF** (documented text formats) are read as layouts or formatted text; they are the interchange routes from InDesign, QuarkXPress and FrameMaker.
3. Binary formats without public specifications (Publisher, QuarkXPress, PageMaker, InDesign binary, Affinity, FrameMaker binaries) get identification and text-and-picture recovery; full readers only if specifications or permissively licensed references exist. The Document Liberation Project's readers (MPL) were consulted as references, not copied.
