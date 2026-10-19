# File formats

QuillPress recognizes files by their **content, not their extension** (`sniffFormat` in `src/io/index.ts`): a misnamed file opens with the right reader. Damaged files go through the recovery pipeline automatically ([RECOVERY.md](RECOVERY.md)).

This file describes what is implemented now. The longer list of page layout formats QuillPress intends to read is in [FORMATS-PLAN.md](FORMATS-PLAN.md).

## Summary

| Format | Extensions | Open | Save | Code |
|---|---|---|---|---|
| QuillPress publication | .qpp | Yes | Yes | `src/io/qpp.ts` |
| Encrypted QuillPress publication | .qppe | Yes | Yes | `src/io/qpp.ts`, `src/util/crypto.ts` |
| QuillPress JSON | .json | Yes | Yes | `src/io/qpp.ts` |
| Scribus document | .sla | Yes | Yes | `src/io/sla.ts` |
| Plain text, Markdown | .txt .md | Place into a frame, or open as a one-page publication | Export (File ▸ Export ▸ Text) | `src/io/textImport.ts`, `src/export/html.ts` |
| Rich Text, Word, HTML | .rtf .docx .html | Place or open | No | `src/io/textImport.ts` |
| Pictures | .png .jpg .gif .webp .bmp .tif .tiff | Place into a frame, or open as a page | PNG, JPEG, SVG per page | `src/io/images.ts`, `src/io/tiff.ts`, `src/export/images.ts` |
| SVG | .svg | Place as a picture, or open as a page of the drawing's size | Yes, per page with the fonts embedded | `src/io/images.ts`, `src/export/images.ts` |
| PDF | .pdf | No | Yes | `src/export/pdf.ts` |
| Web page | .html | — | Yes | `src/export/html.ts` |
| Package | .zip | — | Yes | `file.package` in `src/commands/file.ts` |

## QuillPress publication (.qpp)

A ZIP package, in the OpenDocument tradition:

- `mimetype`, stored first and uncompressed, containing `application/x-quillpress`, so file identifiers and the recovery engine recognize the type from the first bytes;
- `publication.json`: `{ format: "quillpress", version, data, media }`, where `data` is the `Publication` of `src/model/types.ts` (pages, masters, stories, styles, swatches, layers, sections, variables, baseline grid, properties) and `media` lists every picture by id;
- `media/<id>.<ext>`: the pictures themselves (PNG, JPEG, GIF, WebP, BMP, TIFF, SVG), referenced from `media` so the JSON stays small.

`.json` is the same `publication.json` with the pictures embedded as base64, for scripts and bug reports. `.qppe` is the `.qpp` bytes encrypted with AES-256-GCM (PBKDF2 key derivation, magic `QFDE1`); the password is never stored.

Units are points (1/72 in) throughout; the `unit` field only sets what rulers and dialogs show.

## Scribus (.sla)

Scribus 1.4 and 1.5 documents (the open `SCRIBUSUTF8NEW` XML) open and save.

**Imported:** page size, orientation, facing pages (`BOOK`), bleed, margins and columns of the document and of each `MASTERPAGE`; pages with their master; `PAGEOBJECT` and `MASTEROBJECT` frames of type text (4, and 8 text on path, as a text frame), picture (2), shape (6 as a preset or custom path; 7 polyline), line (5), table (16, grid only) and group (12); position, size, rotation, fill and line colors with line width, lock, name and text wrap mode; text frames' columns, gap, insets, vertical alignment and **chains** (`NEXTITEM`/`BACKITEM` by `ItemID`, `NUMPO` or document order); the story text with paragraph styles (`STYLE`, `PARENT`), local alignment, fonts (`Family Bold Italic` names map to bold/italic), sizes and colors; `COLOR` swatches given as RGB or CMYK; embedded pictures (`ImageData`); referenced pictures are recorded by file name as empty frames with a warning (use Tools ▸ Relink Picture).

**Exported:** the same set in reverse. Paragraph styles become `STYLE` elements; swatches become `COLOR`; pictures are embedded as `ImageData`; frames of a story carry `NEXTITEM`/`BACKITEM`; objects on masters are `MASTEROBJECT`. Effects, baseline grid, comments and variables have no Scribus equivalent and are dropped (Save warns and offers .qpp).

The round trip is tested in `tests/unit/io.test.ts`. The reader is tolerant: unknown elements are ignored, and a truncated file is healed by the recovery engine.

## Text and pictures

Place Text File (`insert.textFile`) and the open path share `src/io/textImport.ts`:

- `.txt`: paragraphs on blank lines; single line breaks inside a paragraph are kept as paragraphs (Tools ▸ Clean Up Pasted Text joins them);
- `.md`: `#`…`###` headings become Heading 1–3, `-`/`*`/`1.` lists become Bullet List / Numbered List, `>` becomes Pull Quote, fenced code becomes the Code character style, `**bold**`, `_italic_`, `` `code` `` and links become runs;
- `.rtf`: paragraphs, bold, italic and underline from the control words; fonts and colors are not read;
- `.docx`: paragraphs, heading styles (Heading 1–3 / Title), lists, bold, italic and underline from `word/document.xml`;
- `.html`: headings, paragraphs, lists, blockquotes, bold, italic, links.

Pictures: the type is sniffed from the bytes (`mimeOf`), the pixel size read from the header (`headerSize`) or by decoding; the frame is sized at the picture's resolution (`dpi` from the file when present, otherwise 72 ppi) and fitted inside the margins. TIFF files are converted to BMP in the app (`src/io/tiff.ts`) because browsers do not show TIFF.

## PDF export

`src/export/pdf.ts` is QuillPress's own writer (no PDF library):

- one PDF page per publication page (or per spread), with `/MediaBox` grown by the bleed and `/TrimBox`/`/BleedBox` set, crop marks optional, and `/PageLabels` from the sections;
- text set from the same line layout as the screen (`src/render/text.ts`), using the **standard 14 fonts** (Helvetica, Times, Courier families) chosen by the publication font's classification, WinAnsi encoding; characters outside WinAnsi become `?`;
- shapes and lines as paths (the preset geometry's SVG path is translated to PDF operators), fills, strokes, dashes and opacity (`ExtGState`);
- pictures: JPEG embedded as is (`DCTDecode`, gray/RGB/CMYK), other formats decoded to RGB and compressed (`FlateDecode`) with an `SMask` for transparency; without a canvas (tests, Node) PNG is decoded by `src/io/png.ts`;
- document information from File ▸ Properties.

For the exact screen fonts, print to PDF from the system dialog (File ▸ Print): the print path uses the SVG renderer with the web fonts.

## Other exports

- **SVG and pictures:** the page renderer's SVG with `@font-face` rules for the bundled fonts inlined, so it looks the same anywhere; PNG and JPEG are rasterized from it at a chosen width.
- **Web page:** every page as inline SVG (text stays selectable and searchable), a page navigation, and the stories as flowing text for phones and screen readers.
- **Text and Markdown:** all stories in order; Markdown maps heading, list and quote styles back to syntax.
- **Package:** `.qpp`, `.sla`, PDF, web page, a `Links/` folder with every picture, and `Package report.txt` (pages, fonts, pictures).

## Encryption

`.qppe` files are encrypted with AES-256-GCM using a key derived from the password with PBKDF2-SHA-256 (`src/util/crypto.ts`, shared with the suite). A wrong password is reported as such; the recovery engine cannot repair encrypted files without the password.
