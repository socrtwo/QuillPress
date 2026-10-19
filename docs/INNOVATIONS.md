# Innovations survey

This document surveys page layout and desktop publishing software, past and present, records what each one introduced, and names the QuillPress feature and command id that adopts it (or the reason it is skipped). Dates are given to the year where they are well established. Product names are used only to identify the origin of an idea ([LEGAL.md](LEGAL.md)); corrections are welcome.

## How to read this

Each entry has two parts:
- **Introduced:** what the product or method brought to page layout (not necessarily first ever, but where the idea became widely known).
- **QuillPress:** the feature that adopts it, with command ids and the milestone (M1–M6, see [ROADMAP.md](ROADMAP.md)), or the reason it is skipped.

A summary table is at the end.

---

## 1. Before the desktop: typesetting ideas that still matter

### Metal type and the compositor's craft (to the 1970s)

- **Introduced:** the measure, leading, tracking and kerning; justified columns with hyphenation to avoid rivers; drop caps; rules above and below; running heads and folios; the baseline grid as a consequence of lead slugs of one size.
- **QuillPress:** all of it is in the Text tab: leading (`fmt.lineSpacing`), tracking (`fmt.tracking`), kerning (`fmt.kerning`), justification (`fmt.justify`, `fmt.justifyAll`), hyphenation (`fmt.hyphenation`), drop caps (`fmt.dropCap`), paragraph rules (`fmt.ruleAbove`, `fmt.ruleBelow`), folios and running heads on master pages (`page.editMaster`, `insert.pageNumber`, `insert.titleField`), the baseline grid (`page.baselineGrid`, `fmt.baselineGridAlign`, `view.baselineGrid`). M1.

### TeX and METAFONT (Donald Knuth, 1978–1986)

- **Introduced:** paragraph-at-once line breaking (Knuth–Plass) that minimizes badness across the whole paragraph; a pattern-based hyphenation algorithm (Liang); typesetting as a program; mathematical typesetting.
- **QuillPress:** a first-fit breaker with hyphenation points today (`src/render/text.ts`); Knuth–Plass as an option is planned (M4). Equations are set with Unicode mathematics (`insert.equation`), not a full TeX engine.

### Ventura Publisher (Xerox, 1986)

- **Introduced:** the first widely used **style-sheet-driven** layout program on the PC: tags on paragraphs, frames and master page items that a document inherits; long-document features (table of contents, index, cross references, footnotes) generated from tags; chapters assembled into publications.
- **QuillPress:** paragraph styles with `basedOn` and next-style chains (`fmt.paraStyle`, `fmt.newParaStyle`, `fmt.redefineStyle`), a table of contents built from heading styles (`insert.toc`), index markers and a generated index (`insert.indexMarker`, `insert.index`), text variables (`insert.variable`, `page.variables`). Footnotes and cross references are M4–M5.

### PageMaker (Aldus, 1985)

- **Introduced:** the pasteboard metaphor on the Macintosh: pages with a surrounding work area, text and pictures placed freely, **Place** to import text that flows through columns and pages with a loaded cursor, autoflow, the Story Editor (a plain text window for the story behind the frames), master pages, text wrap around pictures, and the term "desktop publishing".
- **QuillPress:** Place Text File (`insert.textFile`) flows into the margins and offers Autoflow (`text.autoflow`); the Story Editor (`text.storyEditor`); master pages (`page.newMaster`, `page.applyMaster`); text wrap (`arrange.wrap`); objects can sit off the page and are found again with Tools ▸ Objects Off the Page (`tools.offPage`). M1–M2.

### QuarkXPress (Quark, 1987)

- **Introduced:** the **box** model (text boxes and picture boxes with precise numeric control), the Measurements palette, linked text boxes drawn with a linking tool, Step and Repeat, Collect for Output, XPress Tags for styled text interchange, and printing with registration marks and bleed.
- **QuillPress:** every object is a frame with numeric size and position in the status bar and the Size and Position dialog (`arrange.sizeDialog`, `shape.width`, `shape.height`); the link tool with in and out ports on the selection (`text.link`, `text.unlink`); Step and Repeat (`arrange.stepRepeat`); Package Publication (`file.package`) with a report; crop marks and bleed in PDF export and print (`file.export.pdf`, `page.bleed`, `tools.printerMarks`). Tagged text import is M5.

### FrameMaker (Frame Technology, 1986)

- **Introduced:** structured long documents: text flows named and threaded across pages, variables (system and user), conditional text, cross references, running headers from paragraph content, anchored frames that move with their text, books of chapters.
- **QuillPress:** named stories and the Text Threads pane (`text.threadsPane`, `text.storyName`), text variables (`page.variables`), fields that follow sections (`insert.sectionMarker`), continued-on and continued-from numbers (`insert.nextPage`, `insert.prevPage`). Anchored frames, conditional text and books are M4–M6.

### Interleaf, Calamus, Timeworks Publisher, PagePlus (late 1980s–1990s)

- **Introduced:** Interleaf: WYSIWYG document assembly with active documents; Calamus (Atari): vector fonts rendered on screen at any size before outline fonts were common, and a frame "pipeline" for text flow; Timeworks Publisher and Serif PagePlus: desktop publishing for home users with wizards, templates and a friendly price.
- **QuillPress:** vector rendering of everything through one SVG renderer at any zoom (`view.zoom`); the pipeline idea is the frame chain; templates and the New screen (`file.newFromTemplate`, `page.applyTemplate`) keep the home-user approach.

## 2. The 1990s and 2000s: the office suite meets the page

### Microsoft Publisher (1991)

- **Introduced:** publishing for office users: wizards and templates by publication type (newsletter, brochure, business card, postcard), **color schemes and font schemes** that recolor and refont a whole publication, layout guides (rows and columns of guides), a Design Checker, building blocks, mail merge for personalized pieces, and Pack and Go.
- **QuillPress:** templates by type (`file.new`, `src/templates/`), color schemes (`page.colorScheme`) and font schemes (`page.fontScheme`), Layout Guides (`page.layoutGuides`), Preflight as the design checker (`review.preflight`, `review.preflightPane`), Package Publication. Data merge is M5.

### InDesign (Adobe, 1999)

- **Introduced:** the paragraph composer (multi-line breaking), optical margin alignment, OpenType features in the interface, object styles, nested styles, transparency and effects on any object, the Links panel with resolution warnings, preflight live while you work, the Story Editor revived, Paste in Place, IDML as an XML interchange format, liquid layout and alternate layouts (later versions), GREP styles, anchored objects, text on a path.
- **QuillPress:** object styles (`shape.objectStyle`, `shape.newObjectStyle`), effects and transparency (`shape.effects`, `shape.transparency`), the Pictures pane with effective resolution (`review.linksPane`, `picture.info`, `tools.lowResReport`), live preflight pane, Paste in Place (`edit.pasteInPlace`), master item overrides (`page.overrideMasterItem`). Paragraph composer, optical margins, OpenType features, anchored objects, text on a path, IDML and alternate layouts are planned (M4–M5).

### Scribus (2001, open source)

- **Introduced:** a free, open page layout program with an open XML format, Story Editor, PDF/X output, color management and ICC profiles, scripting, and a community-maintained template set.
- **QuillPress:** opens and saves Scribus documents (`file.open`, `file.export.sla`) as the interchange format of the open world; PDF/X and color management are M5.

### LaTeX document classes, Lout, groff, DocBook (typesetting systems)

- **Introduced:** separation of content from presentation; document classes as reusable designs; automatic numbering and references.
- **QuillPress:** styles and masters as the design, stories as the content; sections with numbering (`page.sections`, `page.numbering`); Markdown placement maps headings to styles (`insert.textFile`).

## 3. The 2010s and 2020s: new workflows

### Affinity Publisher (Serif, 2019)

- **Introduced:** a single-window personas approach (switch to photo or vector tools without leaving the layout), IDML import, a free-to-use pricing model, and a preflight panel.
- **QuillPress:** picture adjustments inside the layout (`picture.brightness`, `picture.contrast`, `picture.saturation`, `picture.grayscale`), shapes with editable points (`shape.editPoints`), a preflight pane.

### Canva and the online designers (2013–)

- **Introduced:** design for everyone: templates first, drag and drop, brand kits (colors, fonts, logos), magic resize, collaboration in the browser, and print ordering.
- **QuillPress:** the template gallery on the New screen, color and font schemes as a brand kit, the web app that installs offline, comments for reviewers (`review.newComment`, `review.commentsPane`). Automatic resizing to other page sizes is M5 (alternate layouts).

### Markdown and plain-text publishing (2004–)

- **Introduced:** writing in a plain format and generating output; headings as structure; version control for text.
- **QuillPress:** Markdown placement and export (`insert.textFile`, `file.export.text`), a story editor that shows `[Style]` tags, the JSON format for scripts (`dev.exportJson`).

### Web typography and CSS (2010s)

- **Introduced:** responsive layout, web fonts, `font-variant` features, `hyphens: auto`, and the idea that one document should read on any screen.
- **QuillPress:** the web page export with the stories as flowing text for phones and screen readers (`file.export.html`); fonts embedded in SVG exports; ligature and small-caps switches implemented with CSS font features on screen (`fmt.ligatures`, `fmt.smallCaps`).

### AI writing and layout assistants (2022–)

- **Introduced:** drafting and rewriting text from a brief, generating alt text, suggesting layouts.
- **QuillPress:** the AI tab drafts a whole publication onto laid-out pages (`ai.draftPublication`), drafts stories (`ai.draftStory`), suggests headlines, decks and pull quotes (`ai.headlines`, `ai.decks`, `ai.pullQuotes`), writes captions and alt text (`ai.captions`, `ai.altText`), rewrites, shortens and fits copy by rewriting (`ai.rewrite`, `ai.shorten`, `ai.fitCopy`), and gives layout suggestions built on rule-based checks (`ai.layoutSuggestions`). All optional, previewed, undoable, and able to run on the device ([AI.md](AI.md)).

## 4. QuillPress's own contributions

- **No missing commands** and a command registry that drives the ribbon, the Quick Access Bar (with the union of the desktop drop-downs and Add All Choices), custom tabs, shortcuts, macros and command search. See [COMMANDS-PLAN.md](COMMANDS-PLAN.md) and [QAT.md](QAT.md).
- **Copy fitting two ways:** scale the type until a story fits (`text.fitCopy`) or have the AI shorten the words (`ai.fitCopy`).
- **Clean Up Pasted Text** for copy from PDFs, scans and email: joined lines, end-of-line hyphens, double spaces, ligature characters and straight quotes in one pass (`tools.ocrCleanup`, `tools.convertQuotes`).
- **Recovery before refusal:** damaged publications open with a report ([RECOVERY.md](RECOVERY.md)).
- **Print checklist and booklet order** for people sending work to a printer for the first time (`tools.packageChecklist`, `tools.imposition`).
- **A Quick Access Bar at the bottom** near the on-screen keyboard, and touch-sized handles, so page layout works on a phone or tablet.
- **Spelling in many languages** with downloadable dictionaries, and reading-level statistics for copy (`review.dictionaries`, `review.readingLevel`).

## Summary table

| Idea | Origin | QuillPress command(s) | Status |
|---|---|---|---|
| Style sheets, tags, generated contents and index | Ventura Publisher | `fmt.paraStyle`, `insert.toc`, `insert.index` | Done |
| Place with autoflow, Story Editor, master pages, text wrap | PageMaker | `insert.textFile`, `text.autoflow`, `text.storyEditor`, `page.editMaster`, `arrange.wrap` | Done |
| Boxes with numeric control, link tool, Step and Repeat, Collect for Output, marks | QuarkXPress | `arrange.sizeDialog`, `text.link`, `arrange.stepRepeat`, `file.package`, `tools.printerMarks` | Done |
| Named flows, variables, continued lines | FrameMaker | `text.threadsPane`, `page.variables`, `insert.nextPage` | Done; anchored frames M4 |
| Templates by type, color and font schemes, layout guides, design checker, Pack and Go | Microsoft Publisher | `file.new`, `page.colorScheme`, `page.fontScheme`, `page.layoutGuides`, `review.preflight`, `file.package` | Done; data merge M5 |
| Object styles, effects, Links panel, Paste in Place, live preflight | InDesign | `shape.objectStyle`, `shape.effects`, `review.linksPane`, `edit.pasteInPlace`, `review.preflightPane` | Done |
| Paragraph composer, optical margins, OpenType, anchored objects, text on a path, IDML | InDesign | planned | M4–M5 |
| Open XML format, PDF/X | Scribus | `file.export.sla` | Done; PDF/X M5 |
| Picture adjustments in the layout, editable points | Affinity Publisher | `picture.brightness`, `shape.editPoints` | Done |
| Templates first, brand kits, comments | Canva | `file.newFromTemplate`, `page.colorScheme`, `review.newComment` | Done |
| Knuth–Plass breaking, Liang hyphenation | TeX | `fmt.hyphenation` (heuristic) | Partial; M4 |
| Markdown in and out | plain-text publishing | `insert.textFile`, `file.export.text` | Done |
| Responsive reading of a fixed layout | the web | `file.export.html` | Done |
| AI drafting, captions, alt text, fit copy, layout advice | AI assistants | `ai.*` | Done |
