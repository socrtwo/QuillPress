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
| InDesign Markup Language | .idml | Yes (layout, stories, styles, colors) | Yes (layout, stories, styles, colors, embedded pictures) | `src/io/idml.ts`, `src/io/idmlText.ts`, `src/io/idmlExport.ts`, `src/io/idmlExportText.ts` |
| InDesign document | .indd .indt | Text and pictures only | No | `src/io/legacyLayout.ts` |
| Microsoft Publisher | .pub | Text and pictures only | No | `src/io/mspub.ts`, `src/io/cfb.ts` |
| QuarkXPress document | .qxp .qxd .qxt | Text and pictures only | No | `src/io/legacyLayout.ts` |
| XPress Tags (QuarkXPress text) | .xtg | Yes (styles and formatted text) | No | `src/io/xpressTags.ts` |
| PageMaker publication | .pmd .p65 .pm6 .pmt | Text and pictures only | No | `src/io/legacyLayout.ts` |
| FrameMaker MIF | .mif | Yes (pages, frames, flows, formats) | No | `src/io/mif.ts` |
| Plain text, Markdown | .txt .md | Place into a frame, or open as a one-page publication | Export (File ▸ Export ▸ Text) | `src/io/textImport.ts`, `src/export/html.ts` |
| Rich Text, Word, HTML | .rtf .docx .html | Place or open | No | `src/io/textImport.ts` |
| Pictures | .png .jpg .gif .webp .bmp .tif .tiff | Place into a frame, or open as a page | PNG, JPEG, SVG per page | `src/io/images.ts`, `src/io/tiff.ts`, `src/export/images.ts` |
| SVG | .svg | Place as a picture, or open as a page of the drawing's size | Yes, per page with the fonts embedded | `src/io/images.ts`, `src/export/images.ts` |
| PDF | .pdf | No | Yes (fonts embedded) | `src/export/pdf.ts`, `src/export/fonts/` |
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

## InDesign (.idml, .indd)

**IDML** is Adobe's documented interchange package: a ZIP of XML files. `src/io/idml.ts` reads the package and `src/io/idmlText.ts` its resources and stories.

**Imported:** page size, facing pages, bleed and the display unit (`Resources/Preferences.xml`); layers; master spreads (one QuillPress master per master-spread page, named *A-Master (Left)* / *(Right)* for facing pages) with their margins, columns and items; spreads with pages, each page's margins and columns, and the master applied by side; sections (page numbering) and custom text variables; `Resources/Graphic.xml` colors (CMYK, RGB and Lab), tints and gradients as swatches and fills; `Resources/Styles.xml` paragraph styles (size, font, bold/italic, alignment, indents, spacing, leading, hyphenation, drop caps, keep options, bullets and numbering, tabs, rules, based-on and next style), character styles and object styles; text frames with columns, gutter, insets, vertical alignment, auto-size, ignore-wrap and their story **chains** (`PreviousTextFrame`/`NextTextFrame`); rectangles, ovals, polygons (as custom paths), lines and groups with fills, strokes, dashes, opacity, rotation (from `ItemTransform`), lock, visibility, names and text wrap; picture frames with the picture when it is embedded in the package, otherwise the linked file's name (IDML does not carry linked pictures: the frame is kept and the warning lists the names for Tools ▸ Relink Picture); stories with paragraph and character style ranges and local overrides, forced line breaks, tabs, text variables, hyperlinks' text, tables (as tab-separated rows) and footnotes (into the publication's footnotes when the model has them, otherwise as a *Notes* list at the end of the story). Objects anchored in text are placed as free objects near the story's first frame.

**Not imported:** buttons, forms, sounds and movies (counted in the warning), XML structure, conditional text, object effects beyond opacity, and InDesign's own typesetting (optical kerning, justification settings), so lines break where QuillPress breaks them.

**Exported (File ▸ Save As / Export ▸ InDesign Markup):** `src/io/idmlExport.ts` and `src/io/idmlExportText.ts` write a package laid out as the IDML specification requires: `mimetype` first and stored, `designmap.xml` (with `idPkg:` references to every part, layers, sections, text variables and hyperlinks), `META-INF/container.xml` and `metadata.xml` (XMP title, author, description, keywords), `Resources/Fonts.xml`, `Graphic.xml`, `Preferences.xml`, `Styles.xml`, one `MasterSpreads/MasterSpread_*.xml` per master (a facing pair *X (Left)* / *X (Right)* becomes one two-page master spread), one `Spreads/Spread_*.xml` per page or facing pair, `Stories/Story_*.xml`, `XML/BackingStory.xml` and `XML/Tags.xml`. Every element carries a `Self` id.

What is written:

- Page size, facing pages, bleed, the display unit, the baseline grid and the footnote options (`Preferences.xml`); pages with their margins and columns (`MarginPreference`), the master applied to each page, page labels, sections with their numbering style, start and prefix, and custom text variables.
- Swatches as `Color` elements: CMYK when the swatch's CMYK values reproduce its screen color, RGB otherwise (so the color the publication shows survives a round trip); `Black` and `Paper` are the built-in colors, `None` is `Swatch/None`; hex colors used directly on objects or text become `R=… G=… B=…` colors; gradient fills become `Gradient` swatches; a dash-dot stroke adds a `DashedStrokeStyle`, the other dashes use InDesign's built-in styles.
- Paragraph styles (font, size, bold/italic, color, alignment, indents, space before and after, leading in points — percent leading is converted with the style's size and kept as `AutoLeading` —, hyphenation, drop caps, keep options, baseline alignment, bullets and numbering, tab stops, rules, based-on and next style), character styles and object styles (fill, stroke, insets, columns). `Body` is also written as InDesign's `NormalParagraphStyle`.
- Text frames with their story, chain (`PreviousTextFrame`/`NextTextFrame`), columns, gutter, insets, vertical alignment, auto-size, ignore-wrap and first-baseline option; rectangles, ovals and polygons (preset and custom shapes as Bézier `PathGeometry`), lines with arrowheads, groups; pictures as a frame holding an `Image` whose bytes are embedded in `Contents` (base64) with a `Link` naming the file, so the package needs no external files; rotation and flips through `ItemTransform`; opacity (`BlendingSetting`), text wrap (`TextWrapPreference`), layers (`ItemLayer`), lock, visibility, names and alternative text.
- Stories as `ParagraphStyleRange` / `CharacterStyleRange` with local overrides, forced line breaks (`&#x2028;`), tabs, hyperlinks (`HyperlinkTextSource` plus `Hyperlink` destinations in the design map), footnotes as `Footnote` elements, objects anchored in text nested in their character range with an `AnchoredObjectSetting`, fields as their last displayed text, and tables as InDesign tables (`Table`/`Row`/`Column`/`Cell`) in a story shown by a text frame at the table's position. Text on a path is written as the path with a `TextPath` child and its own story.

Known losses (what InDesign will not see, or what a round trip through QuillPress changes):

- Picture crop, fit and position inside the frame become a fitting option only; picture adjustments (brightness, contrast, saturation, grayscale), image fills and pattern fills, effects (shadow, glow, soft edge), the `behind` wrap mode, guides, page notes, comments and the document's Quick Access Bar are not written.
- Fields (page numbers, dates, variables) are written as their last displayed text, not as live InDesign markers.
- Re-importing a package QuillPress wrote: tables come back as tab-separated rows in a text frame (the importer flattens tables); text on a path comes back as its path only (the importer does not read `TextPath`); anchored objects come back as free objects near their story's first frame; a flipped object comes back rotated rather than flipped, and a shape made from a preset comes back as a custom path with the path's own bounds as its box (a preset whose drawing does not fill its box, such as a star, shrinks to the drawing).

**.indd** (the binary document) has no public specification. QuillPress identifies it by its header and recovers its text (UTF-16 runs) and embedded pictures into frames you can lay out again. Ask InDesign for an IDML export for the real layout.

## Microsoft Publisher (.pub)

A Publisher file is an OLE2 compound file ([MS-CFB], read by `src/io/cfb.ts`). Its `Quill` stream holds the publication's text as UTF-16; its `Contents` and `Escher` streams hold the layout and the pictures as Office Art BLIP records ([MS-ODRAW]). Publisher's own layout structures are not publicly documented (the Microsoft Open Specifications cover the container and the drawing records, not Publisher), so `src/io/mspub.ts` recovers the **text** (paragraph by paragraph, from the Quill stream) and the **pictures** (JPEG, PNG, TIFF and DIB blips, plus any picture found by signature) and places them in flowing frames and on picture pages, with a warning that says so. Frames, styles, master pages and the page size are not read; the page is Letter.

## QuarkXPress (.qxp, .qxd, .qxt) and XPress Tags (.xtg)

QuarkXPress documents (identified by the `MMXPR`/`IIXPR` header) have no public specification; QuillPress recovers their text (Mac Roman for Mac files, Windows Latin for Windows files) and pictures the same way as Publisher files. **XPress Tags**, QuarkXPress's documented tagged-text export, is read properly by `src/io/xpressTags.ts`: the version and encoding header, `@name=` style sheet definitions (alignment, indents, leading, space before and after, size, font), `@name:` paragraph styles, and the character tags for bold, italic, underline, strike, caps, small caps, superscript, subscript, size, font, color and tracking, plus new lines, tabs and special characters. Page geometry is not part of the format; the text flows into frames from the first page.

## PageMaker (.pmd, .p65, .pm6, .pmt)

Identified by the endianness mark and the product name in the header; text (Windows Latin or Mac Roman, whichever reads better) and pictures are recovered as for the other binary formats.

## FrameMaker MIF (.mif)

Maker Interchange Format is FrameMaker's documented text format. `src/io/mif.ts` reads the page size, body pages with their text rectangles (frames with columns), the paragraph catalog (alignment, indents, space before and after, leading, font family, size, weight, angle, hyphenation, next tag, bullets) and the text flows: paragraphs with their tags and local formats, inline font changes, tabs, hard returns and special characters, chained through the rectangles they run through. Tables, anchored frames, graphics, variables (kept as `[Name]`) and master pages are not read yet.

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
- text set from the same line layout as the screen (`src/render/text.ts`) in the publication's **own fonts, embedded as subsets**: every bundled family (Tinos, Arimo, Cousine, Carlito, Caladea, Gelasio, EB Garamond, Libre Baskerville, Lato, Merriweather, Open Sans, Courier Prime) and the names they stand in for (Times New Roman, Arial, Courier New, Calibri, Cambria, Georgia, Garamond, Baskerville, Aptos) are converted from WOFF to TrueType (`src/export/fonts/`), subset to the glyphs used and written as CIDFontType2 fonts with Identity-H encoding and a ToUnicode map, so any Unicode character the face has prints and copies out as text; fonts QuillPress does not bundle (Segoe UI, Verdana, Impact…) fall back to the closest standard 14 font (WinAnsi);
- footnotes and their separator rules, anchored objects where the text put them, and text on a path glyph by glyph;
- shapes and lines as paths (the preset geometry's SVG path is translated to PDF operators), fills, strokes, dashes and opacity (`ExtGState`);
- pictures: JPEG embedded as is (`DCTDecode`, gray/RGB/CMYK), other formats decoded to RGB and compressed (`FlateDecode`) with an `SMask` for transparency; without a canvas (tests, Node) PNG is decoded by `src/io/png.ts`;
- document information from File ▸ Properties.

Printing to PDF from the system dialog (File ▸ Print) goes through the SVG renderer instead and gives the same fonts; the export is the smaller, vector file for the printer.

## Other exports

- **SVG and pictures:** the page renderer's SVG with `@font-face` rules for the bundled fonts inlined, so it looks the same anywhere; PNG and JPEG are rasterized from it at a chosen width.
- **Web page:** every page as inline SVG (text stays selectable and searchable), a page navigation, and the stories as flowing text for phones and screen readers.
- **Text and Markdown:** all stories in order; Markdown maps heading, list and quote styles back to syntax.
- **Package:** `.qpp`, `.sla`, PDF, web page, a `Links/` folder with every picture, and `Package report.txt` (pages, fonts, pictures).

## Encryption

`.qppe` files are encrypted with AES-256-GCM using a key derived from the password with PBKDF2-SHA-256 (`src/util/crypto.ts`, shared with the suite). A wrong password is reported as such; the recovery engine cannot repair encrypted files without the password.
