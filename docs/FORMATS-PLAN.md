# File formats plan

Every page layout format QuillPress intends to recognize, current and historical, with honest status. [FORMATS.md](FORMATS.md) describes what works today. Files are identified by content (`src/io/recover/fileid.ts`), so the plan lists the signatures too.

| Format | Extensions | Signature | Status | Plan |
|---|---|---|---|---|
| QuillPress publication | .qpp .qppe .json | ZIP with `mimetype` = `application/x-quillpress`; `QFDE1`; JSON with `"format":"quillpress"` | **Open and save** | — |
| Scribus | .sla, .sla.gz | XML `<SCRIBUSUTF8NEW` (1.3+) or `<SCRIBUSUTF8` (1.2) | **Open and save** (1.4, 1.5) | Gzip-compressed .sla.gz; 1.2 files; tables' cell text; text on path as a path |
| Microsoft Publisher | .pub | Compound file (OLE2) with a `Quill` stream | Not yet | Milestone M5: read the published [MS-PUB] structure: pages, text boxes (Quill text), pictures, shapes; no save |
| InDesign Markup | .idml | ZIP with `designmap.xml` and `mimetype` = `application/vnd.adobe.indesign-idml-package` | Not yet | M5: spreads, master spreads, text frames and stories, paragraph/character/object styles, swatches, linked pictures by name; save as IDML later |
| InDesign binary | .indd | `DOCUMENT` / `0606EDF5D81D46E5BD31EFE7FE74B71D` GUID header | Not yet | Identification only (text and pictures by harvest); point to IDML export |
| QuarkXPress | .qxp .qxd .qxt | Big-endian `MMXPR3` / `IIXPR3` header | Not yet | Identification; text and picture harvest; a reader for the published 3/4 structures later |
| QuarkXPress Tags / XPress Tags | .xtg | Text starting `<v` version tag | Not yet | M4: place as text with styles |
| PageMaker | .pmd .p65 .pm6 .pmt | `00 00 FF FF` + `PageMaker` strings | Not yet | Identification and harvest |
| FrameMaker MIF | .mif | Text starting `<MIFFile` | Not yet | M5: pages, text flows, paragraph formats |
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
2. **IDML** is the most useful proprietary interchange (an open-specification ZIP of XML), then **Publisher** (specification published by Microsoft).
3. Binary formats without specifications (QuarkXPress, Affinity, PageMaker, FrameMaker binaries) get identification and harvesting; full readers only if specifications or open-source references exist.
