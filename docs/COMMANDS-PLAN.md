# QuillPress command plan

> The planned command inventory, tab by tab. Every id in backticks is a command the app has or will have; `scripts/plan-ids.ts` reads them, and the catalog test reports how many are implemented. Ids are `area.name`; the shared ids (file, edit, view, help, dev, ai setup) match the other Quill apps so settings and macros port across the suite. The generated [COMMANDS.md](COMMANDS.md) lists what ships today.

## Principles

- **No missing commands.** Everything the desktop publishing programs offered that applies to a frame-based page layout app is here, plus the innovations in [INNOVATIONS.md](INNOVATIONS.md). A command is registered only when it works; nothing is a placeholder.
- **Every command is placeable**: Quick Access Bar, custom tabs, keyboard shortcuts, macros and command search (Alt+Q) use the ids below.
- **Ids are stable.** Renaming an id is a breaking change for saved settings and macros.

## File (Backstage)

File: new, open, recover, save, export, print, share, info, options.

### New

- `file.new` — New (Ctrl+n): New publication (blank, or from a template)
- `file.newFromTemplate` — New from Template
- `file.newWithSize` — New Publication with Page Size: Choose the page size, orientation, facing pages, margins and columns of a new publication

### Open

- `file.clearRecent` — Clear Unpinned Recent Publications
- `file.recoveryHelp` — Manual Recovery Options
- `file.open` — Open (Ctrl+o, Ctrl+F12)
- `file.openRepair` — Open and Repair: Open a damaged publication: rebuild its package from raw bytes, repair its JSON or XML, salvage pages, pictures and text, and show what was recovered
- `file.openEncrypted` — Open Encrypted Publication
- `file.openRecent` — Open Recent File
- `file.recoverAny` — Recover Data from Any File: Extract readable text and pictures from any file, however damaged
- `file.recoveryReport` — Recovery Report
- `file.import.idml` — Import InDesign (IDML)…: Spreads, masters, linked frames, stories, styles, swatches and links from an .idml package; .indd files give their text and pictures
- `file.import.layoutFile` — Import Publisher, QuarkXPress or PageMaker File…: Text and pictures recovered from .pub, .qxp, .qxd, .qxt, .pmd, .p65, .pm6, .pmt and .indd files (their layouts are not public formats)
- `file.import.xpressTags` — Import XPress Tags…: Styled text from .xtg files
- `file.import.mif` — Import FrameMaker MIF…: Pages, paragraph catalog, text flows and variables from .mif files

### Save

- `file.autosave` — AutoSave
- `file.save` — Save (Ctrl+s, Shift+F12)
- `file.saveCopy` — Save a Copy
- `file.saveAll` — Save All
- `file.saveAs` — Save As (F12)
- `file.saveTemplate` — Save as Template: Keep this publication's design (masters, styles, swatches, and the pages if you want) as a starting point under File ▸ New ▸ My Templates

### Info

- `file.encrypt` — Encrypt with Password: Save an AES-256 encrypted QuillPress copy (.qppe)
- `file.inspect` — Inspect Publication: Find and remove comments, page notes, hidden objects, off-page content, unused pictures and personal information before sharing
- `file.markFinal` — Mark as Final: Make the publication read-only so readers know it is finished
- `file.readOnly` — Open Read-Only: Protect this tab from changes until you turn this off
- `file.properties` — Properties
- `file.recoverUnsaved` — Recover Unsaved Publications
- `file.revert` — Revert to Saved
- `file.snapshot` — Take Snapshot (Ctrl+Alt+5)
- `file.versions` — Version History *(inspired by Snapshots and version history in writing tools)*

### Export

- `file.export.qppe` — Export as Encrypted QuillPress Publication
- `file.export.json` — Export as QuillPress JSON
- `file.export.qpp` — Export as QuillPress Publication
- `file.export.sla` — Export as Scribus Document
- `file.export.svg` — Export Current Page as SVG
- `file.export.images` — Export Pages as Pictures
- `file.export.text` — Export Text: All stories as plain text or Markdown (headings and lists from the paragraph styles)
- `file.export.pdf` — Export to PDF: A vector PDF with selectable text, page labels, an optional bleed box and crop marks
- `file.export.html` — Export Web Page: One self-contained web page with every page as searchable vector graphics and the text for screen readers
- `file.package` — Package Publication: A ZIP with the publication (.qpp and .sla), every picture as a file, a PDF, a web page, and a report of fonts and pictures used *(inspired by Collect for Output (QuarkXPress), Package (InDesign))*

### Print

- `file.print` — Print Preview and Print (Ctrl+p)
- `file.quickPrint` — Quick Print: Print all pages with the current settings, without the preview

### Share

- `file.email` — Email: Send the publication as an attachment (uses the system share sheet, which includes your mail app and QuillPost when installed)
- `file.emailPdf` — Email as PDF
- `file.share` — Share

### Close

- `file.close` — Close (Ctrl+w, Ctrl+F4)
- `file.closeAll` — Close All
- `file.exit` — Exit

### Options

- `file.autocorrectOptions` — AutoCorrect Options
- `file.customDictionary` — Custom Dictionary
- `file.customizeKeyboard` — Customize Keyboard
- `file.customizeQat` — Customize Quick Access Bar
- `file.customizeRibbon` — Customize Tabs
- `file.exportSettings` — Export / Import Settings
- `file.options` — Options
- `file.resetCustomizations` — Reset All Customizations

## Home

The everyday tab: clipboard, styles, font, paragraph, objects, editing.

### Objects

- `arrange.menu` — Arrange

### Undo

- `edit.redo` — Redo (Ctrl+y, Ctrl+Shift+z, F4): Redo the last undone change, or repeat the last command
- `edit.repeat` — Repeat
- `edit.undo` — Undo (Ctrl+z): Undo the last change

### Clipboard

- `edit.clipboardPane` — Clipboard
- `edit.copy` — Copy (Ctrl+c, Ctrl+Insert)
- `edit.copyFormat` — Copy Formatting (Ctrl+Shift+c)
- `edit.cut` — Cut (Ctrl+x, Shift+Delete)
- `edit.duplicate` — Duplicate (Ctrl+d): Duplicate the selected objects (or the current page when nothing is selected)
- `edit.formatPainter` — Format Painter: Copy formatting from the selection to the next object you click. Double-click (or long-press ▸ Keep Format Painter On) to apply it to several.
- `edit.paste` — Paste (Ctrl+v, Shift+Insert)
- `edit.pastePicture` — Paste as Picture: Paste the copied objects as one SVG picture
- `edit.pasteFormat` — Paste Formatting (Ctrl+Shift+v)
- `edit.pasteInPlace` — Paste in Place (Ctrl+Alt+Shift+v): Paste the copied objects at exactly the position they were copied from (on this page or another) *(inspired by Paste in Place (page layout programs))*
- `edit.pasteObjects` — Paste Objects
- `edit.pasteSpecial` — Paste Special (Ctrl+Alt+v)
- `edit.pasteText` — Paste: Keep Text Only (Ctrl+Shift+Alt+t)

### Editing

- `edit.delete` — Delete
- `edit.deselect` — Deselect All (Ctrl+Shift+a)
- `edit.find` — Find (Ctrl+f)
- `edit.goToObject` — Go to Object: Select an object by its name
- `edit.replace` — Replace (Ctrl+h)
- `edit.replaceFonts` — Replace Fonts: Change every use of one font to another, in styles and in local formatting
- `edit.selectMenu` — Select
- `edit.selectAll` — Select All (Ctrl+a)
- `edit.selectAllPages` — Select All Pages
- `edit.selectNext` — Select Next Object: Cycle through the objects of the page (also Tab on the canvas)
- `edit.selectPrev` — Select Previous Object
- `edit.selectSimilar` — Select Similar

### Styles

- `fmt.charStyle` — Character Styles
- `fmt.deleteCharStyle` — Delete Character Style
- `fmt.deleteStyle` — Delete Paragraph Style
- `fmt.duplicateCharStyle` — Duplicate Character Style
- `fmt.duplicateStyle` — Duplicate Paragraph Style
- `fmt.importStyles` — Load Styles from Publication: Copy the paragraph, character and object styles (and swatches) of another .qpp or .sla file into this publication *(inspired by Load Styles (page layout programs))*
- `fmt.modifyCharStyle` — Modify Character Style
- `fmt.modifyParaStyle` — Modify Paragraph Style
- `fmt.newCharStyle` — New Character Style
- `fmt.newParaStyle` — New Paragraph Style: A new style from the formatting at the caret
- `fmt.paraStyle` — Paragraph Styles: Apply a paragraph style (Body, Heading 1, Pull Quote…)
- `fmt.redefineCharStyle` — Redefine Character Style from Selection
- `fmt.redefineStyle` — Redefine Style from Selection: Make the paragraph style look like the formatting at the caret, and remove the local overrides *(inspired by Redefine style (page layout programs))*
- `fmt.selectByStyle` — Select Frames by Style: Select every text frame on this page whose text uses a style
- `fmt.styleChain` — Style Inheritance: Show what the paragraph style at the caret is based on and the formatting it resolves to
- `fmt.stylesPane` — Styles (F11)

### Font

- `fmt.bold` — Bold (Ctrl+b)
- `fmt.changeCase` — Change Case (Shift+F3)
- `fmt.clearFormatting` — Clear All Formatting (Ctrl+Space): Remove local formatting; the paragraph and character styles stay
- `fmt.font` — Font
- `fmt.fontColor` — Font Color
- `fmt.fontSize` — Font Size
- `fmt.fontDialog` — Font (Ctrl+Shift+f)
- `fmt.growFont` — Grow Font (Ctrl+Shift+.)
- `fmt.highlight` — Highlight
- `fmt.italic` — Italic (Ctrl+i)
- `fmt.shrinkFont` — Shrink Font (Ctrl+Shift+,)
- `fmt.strike` — Strikethrough
- `fmt.subscript` — Subscript (Ctrl+=)
- `fmt.superscript` — Superscript (Ctrl+Shift+=)
- `fmt.underline` — Underline (Ctrl+u)

### Paragraph

- `fmt.alignLeft` — Align Left (Ctrl+l)
- `fmt.alignRight` — Align Right (Ctrl+Shift+r)
- `fmt.bullets` — Bullets (Ctrl+Shift+8)
- `fmt.listDialog` — Bullets and Numbering
- `fmt.alignCenter` — Center (Ctrl+e)
- `fmt.outdent` — Decrease Indent (Ctrl+Shift+m)
- `fmt.dropCap` — Drop Cap *(inspired by Drop caps (Ventura Publisher, PageMaker))*
- `fmt.dropCapDialog` — Drop Cap Options
- `fmt.indent` — Increase Indent (Ctrl+m)
- `fmt.justify` — Justify (Ctrl+j)
- `fmt.justifyAll` — Justify All Lines: Justify the last line of each paragraph too
- `fmt.lineSpacing` — Leading: Line spacing: a percentage of the type size, or exact points
- `fmt.numbering` — Numbering (Ctrl+Shift+7)
- `fmt.paraSpacing` — Paragraph Spacing
- `fmt.paragraphDialog` — Paragraph (Ctrl+Alt+m)
- `fmt.restartNumbering` — Restart Numbering

## Insert

Pages, text, pictures, shapes, tables, fields, symbols and links.

### Text

- `insert.caption` — Caption: A caption frame under the selected picture or object
- `insert.textFile` — Place Text File (Ctrl+Shift+d): Flow a .txt, .md, .rtf, .docx or .html file into the selected text frame, or a new frame chain through the pages *(inspired by Place (PageMaker), Get Text (QuarkXPress))*
- `insert.placeholderText` — Placeholder Text: Fill the selected frame (or a new one) with placeholder text to see how the layout reads *(inspired by Lorem ipsum fill (page layout programs))*
- `insert.pullQuote` — Pull Quote: A quotation frame with rules above and below, that body text wraps around *(inspired by Pull quotes (magazine layout))*
- `insert.sidebar` — Sidebar: A tinted box with its own text, that body text wraps around
- `insert.toc` — Table of Contents: A contents frame built from the Heading 1–3 paragraphs across the pages, with page numbers *(inspired by Generated contents (Ventura Publisher, FrameMaker))*
- `insert.textFrame` — Text Frame (Ctrl+Shift+t, t): Drag to draw a text frame; type into it, or link it to another frame so text flows between them
- `insert.textOnPath` — Text on a Path: Text set along a line, an arc, a circle, a wave or a zigzag; or convert a shape with Text Path ▸ From Shape *(inspired by Text on a path (CorelDRAW, Illustrator, InDesign))*
- `insert.inlinePicture` — Inline Picture: Place a picture in the text at the caret; it moves with the text like a character *(inspired by Inline graphics (PageMaker, Ventura Publisher))*
- `insert.inlineFrame` — Inline Text Frame: A small text frame set in the text at the caret, moving with it

### Pictures

- `insert.picture` — Picture (Ctrl+Shift+i): Place one or more pictures (PNG, JPEG, GIF, WebP, BMP, TIFF, SVG); an empty picture frame that is selected receives the first
- `insert.pictureFrame` — Picture Frame (f): Draw an empty picture frame to hold a picture later (double-click it to place one) *(inspired by Picture boxes (QuarkXPress))*
- `insert.pictureFromUrl` — Picture from Web Address
- `insert.screenshot` — Screenshot: Capture a window or screen (the browser asks which) and place it as a picture

### Illustrations

- `insert.arrow` — Arrow
- `insert.arrowLine` — Arrow Line
- `insert.ellipse` — Ellipse (l)
- `insert.line` — Line (\)
- `insert.polygon` — Polygon
- `insert.rectangle` — Rectangle (m)
- `insert.shape` — Shapes
- `insert.star` — Star

### Tables

- `insert.drawTable` — Draw Table: Drag the table's outline; it gets 3 columns and 4 rows to start
- `insert.table` — Table
- `insert.tableFromText` — Table from Text: Paste tab-, comma- or semicolon-separated text (from a spreadsheet, for example)

### Pages

- `insert.pageCount` — Page Count
- `insert.pageNumber` — Page Number (Ctrl+Alt+Shift+n): The current page's number (on a master page: the number of each page that uses it)
- `insert.sectionMarker` — Section Name: The name of the section the page is in (Page Design ▸ Sections)

### Fields

- `insert.dateTime` — Date and Time
- `insert.nextPage` — Next Page Number: "Continued on page N": the page the story continues on
- `insert.prevPage` — Previous Page Number: "Continued from page N"
- `insert.titleField` — Publication Title: The title from File ▸ Properties, kept up to date
- `insert.variable` — Text Variable: Text that is defined once and used in many places (a product name, an issue date…) *(inspired by Text variables (FrameMaker))*

### Symbols

- `insert.codeBlock` — Code Block
- `insert.emoji` — Emoji
- `insert.equation` — Equation: Type an equation in plain notation (x^2, a/b, sqrt(x), alpha, <=, !=, inf, sum, int); it is set with Unicode math characters
- `insert.specialChar` — Special Characters
- `insert.symbol` — Symbol

### Links

- `insert.bookmark` — Bookmark: Name the selected object so links (#name) and the Navigator can jump to it
- `insert.comment` — Comment
- `insert.index` — Generate Index: A frame listing every index entry alphabetically with its page numbers
- `insert.indexMarker` — Index Entry: Mark the caret position with an index term; Insert ▸ Generate Index lists every term with its page *(inspired by Index markers (Ventura Publisher, FrameMaker))*
- `insert.link` — Link (Ctrl+k): A web address on the selected text or object (kept in PDF and web exports)
- `insert.removeLink` — Remove Link

## Page Design

Page setup, master pages, guides and grids, numbering, schemes and swatches.

### Pages

- `page.delete` — Delete Page: Delete the selected pages (text flows on into the remaining frames of each story)
- `page.duplicate` — Duplicate Page: A copy of the selected pages after them (text frames get their own copies of the stories)
- `page.insert` — Insert Page (Ctrl+Shift+p): A new page after the current one, on the same master
- `page.insertBefore` — Insert Page Before
- `page.insertMany` — Insert Pages
- `page.moveDown` — Move Page Down (Ctrl+Alt+ArrowDown)
- `page.moveUp` — Move Page Up (Ctrl+Alt+ArrowUp)
- `page.move` — Move Page
- `page.rename` — Name Page: A name for the page in the Pages pane and Navigator (page numbers come from sections)
- `page.notes` — Page Notes: Production notes for this page (not printed)

### Page Setup

- `page.bleed` — Bleed: Extra area outside the page edge that is trimmed off after printing; pictures and colors that run to the edge should extend into it *(inspired by Bleed and slug (prepress))*
- `page.columns` — Columns: Column guides of the master (new text frames placed over the margins use them)
- `page.facing` — Facing Pages: Lay out pages in left/right spreads with inside and outside margins
- `page.margins` — Margins: Margins of the master (or of the selected pages only)
- `page.orientation` — Orientation
- `page.setupDialog` — Page Setup (Ctrl+Alt+p)
- `page.size` — Page Size

### Master Pages

- `page.applyMaster` — Apply Master: Apply a master to the selected pages
- `page.applyMasterAll` — Apply Master to All Pages
- `page.closeMaster` — Close Master Page
- `page.deleteMaster` — Delete Master
- `page.duplicateMaster` — Duplicate Master
- `page.editMaster` — Edit Master Page (Ctrl+Shift+m): Edit the items every page built on this master shares (folios, running heads, rules)
- `page.hideMasterItems` — Hide Master Items: Hide the master page's items on the selected pages
- `page.masterOptions` — Master Options
- `page.newMaster` — New Master
- `page.overrideMasterItem` — Override Master Item: Copy a master page item onto this page so it can be changed here (choose it from the list) *(inspired by Master item overrides (page layout programs))*
- `page.renameMaster` — Rename Master

### Guides and Grids

- `page.addGuide` — Add Guide: Drag from a ruler, or click here and drag on the page; the arrow adds a guide at an exact position
- `page.baselineGrid` — Baseline Grid: The spacing text baselines snap to when a paragraph has Align to Baseline Grid on *(inspired by Baseline grids (magazine layout))*
- `page.clearGuides` — Clear Guides
- `page.guidesDialog` — Guides
- `page.layoutGuides` — Layout Guides: Rows and columns of guides inside the margins, for a modular grid *(inspired by Layout guides (Microsoft Publisher), Create Guides (InDesign))*
- `page.lockGuides` — Lock Guides

### Numbering

- `page.numbering` — Page Numbering: How pages are numbered from this page on (a section starts here if none does)
- `page.sections` — Sections
- `page.variables` — Text Variables: Define named text used by Insert ▸ Text Variable; changing a value updates every use

### Schemes

- `page.applyTemplate` — Apply Template: Take the masters, styles and swatches of a template; the pages keep their content
- `page.colorScheme` — Color Scheme: Set the Primary, Secondary and Accent swatches at once *(inspired by Color schemes (Microsoft Publisher))*
- `page.deleteSwatch` — Delete Swatch
- `page.duplicateSwatch` — Duplicate Swatch
- `page.editSwatch` — Edit Swatch
- `page.fontScheme` — Font Scheme: Set the heading and body fonts of every paragraph style at once *(inspired by Font schemes (Microsoft Publisher))*
- `page.newSwatch` — New Swatch
- `page.background` — Page Background: A color behind everything on the selected pages (the arrow picks it)
- `page.swatchesPane` — Swatches (F5)

## Text

Text frames and flow, frame options, typography, paragraph flow and text tools.

### Typography

- `fmt.baselineGridAlign` — Align to Baseline Grid: Snap this paragraph's baselines to the publication's baseline grid
- `fmt.allCaps` — All Caps (Ctrl+Shift+a)
- `fmt.baselineShift` — Baseline Shift: Raise or lower the text relative to the baseline (% of the size)
- `fmt.hyphenation` — Hyphenate: Break long words at syllable-like points so justified text has fewer gaps *(inspired by TeX hyphenation)*
- `fmt.kerning` — Kerning: Pair kerning from the font (on by default)
- `fmt.ligatures` — Ligatures: Standard ligatures (fi, fl) from the font
- `fmt.opticalMargin` — Optical Margin Alignment: Hang punctuation and the open sides of letters outside the margins so the edges of the paragraph look straight *(inspired by Hanging punctuation (Gutenberg; InDesign optical margin alignment))*
- `text.opticalMarginSize` — Optical Margin Size: The type size the overhang is tuned for (text of that size hangs by the full amount, larger text by less, smaller by more)
- `text.opticalMarginStory` — Optical Margins for Story: Optical margin alignment for every paragraph of the selected story (a paragraph's own setting still wins)
- `fmt.smallCaps` — Small Caps (Ctrl+Shift+k)
- `fmt.tabs` — Tabs
- `fmt.language` — Text Language: The language of the selected text (for spelling and hyphenation)
- `fmt.tracking` — Tracking: Letter spacing in points (negative tightens)

### Paragraph Flow

- `fmt.keepLines` — Keep Lines Together: Do not split this paragraph between columns or frames
- `fmt.keepWithNext` — Keep with Next: Never leave this paragraph at the bottom of a column without the next one
- `fmt.ruleAbove` — Rule Above *(inspired by Paragraph rules (Ventura Publisher))*
- `fmt.ruleBelow` — Rule Below

### Text Frames

- `text.autoflow` — Autoflow: Add linked frames (and pages) until every overset story fits *(inspired by Autoflow (PageMaker))*
- `text.link` — Link Frames (Ctrl+Shift+l): Flow the selected frame's story into another frame: click this, then click the frame the text should continue in *(inspired by Linked text frames (Ventura, PageMaker, QuarkXPress))*
- `text.nextFrame` — Next Frame in Story (Ctrl+Alt+PageDown)
- `text.prevFrame` — Previous Frame in Story (Ctrl+Alt+PageUp)
- `text.splitStory` — Split Story Here: Make the selected frame the start of a new story (the frames before it keep theirs)
- `text.threadsPane` — Text Threads
- `text.unlink` — Unlink Frame: Break the chain after the selected frame; the text that follows gets its own story

### Frame Options

- `text.autosize` — Auto-Size Height: The frame grows or shrinks to fit its text (single frames only)
- `text.fitFrameToText` — Fit Frame to Text (Ctrl+Alt+c)
- `text.columns` — Frame Columns
- `text.ignoreWrap` — Ignore Text Wrap: Text in this frame flows under objects that have wrap on
- `text.insets` — Insets: Space between the frame edge and its text
- `text.frameOptions` — Text Frame Options (Ctrl+Alt+b)
- `text.verticalAlign` — Vertical Alignment
- `text.vertical` — Vertical Text: Rotate the text 90° inside the frame (for spines and tabs)

### Notes

- `text.insertFootnote` — Insert Footnote (Ctrl+Alt+f): A numbered reference at the caret, with its note set at the bottom of the column *(inspired by Footnotes (Ventura Publisher, FrameMaker, InDesign))*
- `text.editFootnote` — Edit Footnote: Edit the text of the footnote at the caret
- `text.deleteFootnote` — Delete Footnote: Remove the footnote at the caret and its reference
- `text.nextFootnote` — Next Footnote
- `text.prevFootnote` — Previous Footnote
- `text.goToReference` — Go to Reference: Put the caret after the reference of a footnote
- `text.footnoteOptions` — Footnote Options: numbering scheme, restart per story or page, separator rule, note style, placement
- `text.footnotesToEndnotes` — Footnotes to Endnotes: Move the story's footnotes into a "Notes" section at its end, keeping the numbers as links
- `text.endnotesToFootnotes` — Endnotes to Footnotes: Turn a "Notes" section made by Footnotes to Endnotes back into footnotes
- `text.footnotesPane` — Footnotes: Every footnote of the publication: click one to go to its reference, edit its text in place

### Tools

- `text.changeCase` — Change Case
- `text.clearStory` — Clear Story Text
- `text.editText` — Edit Text (F2): Start editing the selected frame's text
- `text.insertLorem` — Fill with Placeholder Text
- `text.fitCopy` — Fit Copy: Scale the story's type down (or up) so it exactly fills its frames *(inspired by Copy fitting (QuarkXPress, Ventura))*
- `text.storyName` — Name Story
- `text.oversetReport` — Overset Text: Every frame whose story does not fit, with the characters cut off
- `text.neededHeight` — Report Needed Height: How tall the selected frame must be for its text
- `text.scaleType` — Scale Type: Multiply every type size in the selected frames by a factor
- `text.storyEditor` — Story Editor (Ctrl+y): Edit the whole story as plain paragraphs in a window, whatever frames it flows through *(inspired by Story Editor (PageMaker), Story Editor (Scribus))*
- `text.newStoryFromSelection` — Text to New Frame: Move the selected text into a new frame of its own
- `text.wordCount` — Word Count

## Arrange

Order, align, group, rotate, text wrap, size and position, layers.

### Order

- `arrange.bringForward` — Bring Forward (Ctrl+])
- `arrange.bringToFront` — Bring to Front (Ctrl+Shift+])
- `arrange.sendBackward` — Send Backward (Ctrl+[)
- `arrange.sendToBack` — Send to Back (Ctrl+Shift+[)

### Align

- `arrange.align` — Align
- `arrange.alignBottom` — Align Bottom: Aligns the selected objects to each other (or to the page when Align to Page is on, or only one is selected)
- `arrange.alignCenter` — Align Center: Aligns the selected objects to each other (or to the page when Align to Page is on, or only one is selected)
- `arrange.alignLeft` — Align Left: Aligns the selected objects to each other (or to the page when Align to Page is on, or only one is selected)
- `arrange.alignMiddle` — Align Middle: Aligns the selected objects to each other (or to the page when Align to Page is on, or only one is selected)
- `arrange.alignRight` — Align Right: Aligns the selected objects to each other (or to the page when Align to Page is on, or only one is selected)
- `arrange.alignToMargins` — Align to Margins: Snap the selected objects to the page margins
- `arrange.alignToPage` — Align to Page
- `arrange.alignTop` — Align Top: Aligns the selected objects to each other (or to the page when Align to Page is on, or only one is selected)
- `arrange.centerOnPage` — Center on Page
- `arrange.distributeH` — Distribute Horizontally
- `arrange.distributeV` — Distribute Vertically

### Group

- `arrange.group` — Group (Ctrl+Shift+g)
- `arrange.hide` — Hide (Ctrl+3): Hidden objects do not print or export; Show All brings them back
- `arrange.lock` — Lock (Ctrl+Alt+l): Locked objects cannot be moved or resized (they can still be selected and edited)
- `arrange.showAll` — Show All on Page (Ctrl+Alt+3)
- `arrange.ungroup` — Ungroup (Ctrl+Alt+Shift+g)
- `arrange.unlockAll` — Unlock All on Page

### Rotate

- `arrange.flipH` — Flip Horizontal
- `arrange.flipV` — Flip Vertical
- `arrange.rotate` — Rotate
- `arrange.rotateLeft` — Rotate Left 90°
- `arrange.rotateRight` — Rotate Right 90°

### Text Wrap

- `arrange.wrapBehind` — Behind Text
- `arrange.wrapTopBottom` — Jump Object: Text stops above and continues below
- `arrange.wrapNone` — No Wrap: Text runs under the object
- `arrange.wrap` — Text Wrap: How text in frames beneath flows around the selected objects *(inspired by Text wrap / runaround (PageMaker, QuarkXPress))*
- `arrange.wrapSquare` — Wrap Around Bounding Box: Text keeps clear of the object's rectangle
- `arrange.wrapTight` — Wrap Around Shape: Text follows the shape (and the picture's edges)
- `arrange.wrapOffset` — Wrap Distance

### Anchor

- `arrange.anchorInline` — Anchor Inline: The selected object sits in the text like a character and moves with it; its line grows to hold it *(inspired by Inline graphics (PageMaker, Ventura, InDesign anchored objects))*
- `arrange.anchorAbove` — Anchor Above Line: The selected object sits above the line it is anchored in and moves with the text
- `arrange.anchorCustom` — Anchor at Offset: The selected object keeps its distance from a point in the text and moves when that text moves
- `arrange.releaseAnchor` — Release Anchor: The object stays where it is and no longer moves with the text
- `arrange.anchorOptions` — Anchor Options: position mode, inline alignment, horizontal alignment, offsets

### Text Path

- `path.fromShape` — From Shape: Set text along the outline of the selected shape, frame or line (the shape itself can stay underneath)
- `path.editText` — Edit Path Text
- `path.align` — Align on Path: start, center, end, or spread along the path
- `path.offset` — Start Offset: Distance along the path before the text starts
- `path.baseline` — Baseline Shift: Raise the text above the path (negative values put it below)
- `path.flip` — Flip to Other Side: Set the text on the other side of the path, running the other way
- `path.spacing` — Character Spacing
- `path.showPath` — Show Path: Draw the path with the item's outline
- `path.release` — Release to Text Frame: Put the text back into an ordinary text frame of the same size

### Size and Position

- `arrange.deleteLayer` — Delete Layer
- `arrange.layerOptions` — Layer Options
- `arrange.layersPane` — Layers
- `arrange.makeSameSize` — Make Same Size: Give every selected object the size of the first one selected
- `arrange.moveToLayer` — Move to Layer
- `arrange.newLayer` — New Layer
- `arrange.sizeDialog` — Size and Position (Ctrl+Shift+s)
- `arrange.stepRepeat` — Step and Repeat (Ctrl+Alt+u): Copies of the selection at a regular offset (business cards, labels, grids) *(inspired by Step and Repeat (QuarkXPress, InDesign))*

### Shape

- `shape.applySwatch` — Apply Swatch: Fill the selected objects (or color the text being edited) with a swatch
- `shape.change` — Change Shape: Give the selected frames or shapes another geometry (text and pictures stay)
- `shape.convertToPicture` — Convert to Picture Frame: Make the selected shape an empty picture frame of the same geometry
- `shape.convertToText` — Convert to Text Frame: Make the selected shape or picture frame a text frame of the same geometry (type into it)
- `shape.corners` — Corner Rounding: Round the corners of rectangular frames and shapes
- `shape.deleteObjectStyle` — Delete Object Style
- `shape.duplicateObjectStyle` — Duplicate Object Style
- `shape.editPoints` — Edit Points: Edit the shape as an SVG path (M, L, C, Q, Z commands in a 100 × 100 box)
- `shape.effects` — Effects
- `shape.fill` — Fill: Fill color of the selected frames and shapes (the arrow picks a color or swatch)
- `shape.gradient` — Gradient Fill
- `shape.lineDash` — Line Dash
- `shape.lineEnds` — Line Ends
- `shape.lineWidth` — Line Width
- `shape.modifyObjectStyle` — Modify Object Style
- `shape.name` — Name Object
- `shape.newObjectStyle` — New Object Style: A new object style from the selected object's formatting
- `shape.objectStyle` — Object Styles: Named fills, outlines, effects and insets for frames and shapes
- `shape.outline` — Outline: Outline color, width and dash of the selected objects
- `shape.outlineColor` — Outline Color
- `shape.pictureFill` — Picture Fill
- `shape.redefineObjectStyle` — Redefine Object Style from Selection
- `shape.transparency` — Transparency: Opacity of the whole object (%)

### Size

- `shape.height` — Height
- `shape.width` — Width

## Review

Spelling, statistics, preflight, accessibility, comments, language.

### Proofing

- `review.compare` — Compare with File: Compare this publication's text with another .qpp or .sla file, story by story
- `review.dictionaries` — Dictionaries: Download spelling dictionaries for other languages
- `review.readingLevel` — Reading Level: Readability of the publication's text (Flesch reading ease and grade level)
- `review.spelling` — Spelling (F7): Check spelling from the current page on
- `review.statistics` — Statistics

### Preflight

- `review.fontsUsed` — Fonts Used
- `review.linksPane` — Pictures Pane: Every picture, its size, resolution and where it is used
- `review.preflight` — Preflight (Ctrl+Alt+Shift+f): Check the publication for printing problems *(inspired by Preflight (prepress), Design Checker (Microsoft Publisher))*
- `review.preflightPane` — Preflight Pane

### Accessibility

- `review.altText` — Alt Text
- `review.checkAccessibility` — Check Accessibility
- `review.decorative` — Mark as Decorative

### Comments

- `review.commentsPane` — Comments
- `review.deleteAllComments` — Delete All Comments
- `review.deleteComment` — Delete Comment
- `review.newComment` — New Comment (Ctrl+Alt+m)
- `review.nextComment` — Next Comment
- `review.prevComment` — Previous Comment

### Language

- `review.language` — Language: The publication's language (spelling dictionary, hyphenation, exports)
- `review.lookUp` — Look Up: Look the selected word up in an online dictionary
- `review.translate` — Translate: Translate the selected text with the AI provider

## View

Views, show/hide, zoom, color, panes, window, Quick Access Bar and ribbon.

### Views

- `view.previewMode` — Preview (Ctrl+Shift+w): Hide guides, frame edges and panes: see the page as it prints (W toggles while nothing is selected)
- `view.single` — Single Page: One page at a time
- `view.spread` — Spreads: Facing pages side by side, as the reader sees them

### Show

- `view.baselineGrid` — Baseline Grid (Ctrl+Alt+'): The grid lines text baselines snap to (Page Design ▸ Baseline Grid sets its spacing)
- `view.grid` — Document Grid (Ctrl+')
- `view.frameEdges` — Frame Edges (Ctrl+Alt+h)
- `view.gridSettings` — Grids and Guides
- `view.guides` — Guides (Ctrl+;): Margin, column and ruler guides
- `view.pagesPane` — Pages Pane
- `view.rulers` — Rulers (Ctrl+r)
- `view.smartGuides` — Smart Guides
- `view.snapToGrid` — Snap to Grid
- `view.snapToGuides` — Snap to Guides
- `view.textThreads` — Text Threads (Ctrl+Alt+y): Lines between linked text frames

### Panes

- `view.layersPane` — Layers (Alt+F10)
- `view.navigator` — Navigator *(inspired by Navigator panes in office suites)*

### Zoom

- `view.actualSize` — Actual Size (Ctrl+1)
- `view.fitPage` — Fit Page (Ctrl+0)
- `view.fitWidth` — Fit Width (Ctrl+Alt+0)
- `view.zoom` — Zoom: Zoom percentage
- `view.zoomIn` — Zoom In (Ctrl+=)
- `view.zoomOut` — Zoom Out (Ctrl+-)
- `view.zoomSelection` — Zoom to Selection (Ctrl+Alt+=)

### Color

- `view.color` — Color
- `view.grayscale` — Grayscale: Preview the pages as they print in grayscale

### Window

- `view.fullScreen` — Full Screen: Hide the ribbon and use the whole screen for the pages (Esc returns)
- `view.newWindow` — New Window: A second view of this publication in the same window (as a tab): edits show in both
- `view.statusBar` — Status Bar
- `view.switchWindow` — Switch Windows (Ctrl+F6)

### Help

- `view.cmdSearch` — Search Commands (Alt+q)

### Quick Access Bar

- `view.qatAddAll` — Add All Quick Access Choices (A–Z): Put every drop-down choice on the Quick Access Bar: Save and Print first, then the rest alphabetically
- `view.qatHide` — Hide Quick Access Bar
- `view.qatLabels` — Quick Access Bar Labels
- `view.qatPosition` — Quick Access Bar Position
- `view.qatShow` — Show Quick Access Bar

### Ribbon

- `view.collapseRibbon` — Collapse the Ribbon (Ctrl+F1)
- `view.touchMode` — Touch/Mouse Mode: More space between commands for fingers

### Appearance

- `view.theme` — Dark Mode
- `view.unit` — Measurement Unit: The unit shown in rulers, the status bar and dialogs

## Tools

Fonts, pictures, clean-up, text fixes, packaging.

### Fonts

- `tools.findFont` — Find Font: Every font in use, where it is used, and whether it is available; select the frames or replace the font *(inspired by Find Font (page layout programs))*

### Pictures

- `tools.compressPictures` — Compress Pictures
- `tools.extractMedia` — Extract Pictures: Save every picture of the publication in one ZIP file
- `tools.lowResReport` — Low-Resolution Pictures
- `tools.relink` — Relink Picture: Replace a picture with a new file everywhere it is used (for example a higher-resolution version)

### Clean Up

- `tools.emptyFrames` — Empty Frames
- `tools.offPage` — Objects Off the Page
- `tools.unusedStyles` — Remove Unused Styles
- `tools.unusedSwatches` — Remove Unused Swatches
- `tools.resetMasterItems` — Reset Master Items: Remove this page's overrides of master page items so the master shows through again

### Text

- `tools.ocrCleanup` — Clean Up Pasted Text: Fix text pasted from PDFs, scans or email: joined lines, end-of-line hyphens, double spaces, ligature characters, straight quotes
- `tools.fillWithPlaceholder` — Fill Empty Frames with Placeholder
- `tools.textToFrames` — Split Story into Frames: Make each paragraph of the selected frame its own frame (for headlines, decks and bylines laid out separately)
- `tools.convertQuotes` — Typographer's Quotes: Turn straight quotes and apostrophes into curly ones in the selected frames (or everywhere) *(inspired by Convert Quotes (Ventura, PageMaker))*

### Package

- `tools.imposition` — Booklet Order: The printer's spread order for a folded booklet of these pages *(inspired by Imposition (prepress))*
- `tools.packageChecklist` — Print Checklist: What to check before sending a publication to a printer
- `tools.printerMarks` — Printer's Marks: Default marks for PDF export and printing: crop marks, bleed, slug notes

## AI

Setup, several AIs, create, write, design, more.

### Setup

- `ai.active` — Active AI: Switch between the AI providers you have set up
- `ai.privacy` — AI & Privacy: Where your text goes when you use AI
- `ai.settings` — AI Settings: Turn AI on or off, language for generated text, style guide, usage
- `ai.deleteModels` — Delete Downloaded Models: Free the storage used by the on-device AI model
- `ai.providers` — Providers & Models: Switch AI provider, choose models, test or remove keys
- `ai.setup` — Set Up AI: Choose a free or paid AI: on this device, free cloud tiers, your own computer, or a paid key
- `ai.stop` — Stop AI: Stop the AI request in progress

### Several AIs

- `ai.ensembleMembers` — Choose AIs: Choose which AIs answer together, the master or clerk, and the rounds of discussion
- `ai.ensembleMode` — Several AIs: Ask one AI, or several at once: one AI combines their answers (master), or they deliberate until they agree (Quaker consensus)
- `ai.showDeliberation` — Show AI Discussion: Show the outcome of the discussion when several AIs answer

### Create

- `ai.draftPublication` — Draft Publication: Describe the publication; the AI writes the articles, then QuillPress lays them out on pages with headlines, decks, columns, sidebars and pull quotes
- `ai.draftStory` — Draft Story: Write an article about a topic into the selected frame (or a new one)
- `ai.decks` — Suggest Deck: A one-sentence summary to print under the headline
- `ai.headlines` — Suggest Headlines: Headline ideas for the selected story; the chosen one replaces its heading (or is added above)
- `ai.pullQuotes` — Suggest Pull Quotes: Striking sentences from the selected story, placed as a pull quote frame that the text wraps around
- `ai.captions` — Write Caption: Captions for the selected picture (the picture is sent to models with vision; others use its name and the page text)

### Write

- `ai.tone` — Change Tone: Change Tone the selected text or the selected frame's story
- `ai.expand` — Expand: Expand the selected text or the selected frame's story
- `ai.fitCopy` — Fit Copy by Rewriting: Shorten the overset story in words (not type size) until it fits its frames *(inspired by Copy fitting by editors)*
- `ai.proofread` — Proofread: Proofread the selected text or the selected frame's story
- `ai.rewrite` — Rewrite: Rewrite the selected text or the selected frame's story
- `ai.shorten` — Shorten: Shorten the selected text or the selected frame's story
- `ai.translate` — Translate: Translate the selected text or the selected frame's story

### Design

- `ai.altText` — Generate Alt Text: Describe the selected picture (the picture itself is sent; models without vision use its name and the page text)
- `ai.layoutSuggestions` — Layout Suggestions: Observations about this page (measure, overset, resolution, fonts) plus the AI's suggestions
- `ai.styleNames` — Suggest Styles: Let the AI decide which paragraphs of the selected story are headlines, decks, bylines, subheads, body, lists and captions, then apply those styles
- `ai.summarize` — Summary Box: A sidebar summarizing the publication's text ("In brief")

### More

- `ai.assistant` — AI Assistant: Ask questions about this publication (its text is sent with your question)
- `ai.prompts` — Prompt Library: Run one of your saved prompts on the selected text

## Developer

Macros and data.

### Code

- `dev.macroEditor` — Macro Editor: Edit a macro's steps (one command per line: id and an optional JSON argument)
- `dev.macroSecurity` — Macro Security
- `dev.macros` — Macros (Alt+F8): Run, rename, delete or put a macro on the Quick Access Bar
- `dev.recordMacro` — Record Macro: Record the commands you run (formatting, inserting, page changes) to replay them later
- `dev.stopRecording` — Stop Recording

### Data

- `dev.exportJson` — Export Publication JSON
- `dev.importJson` — Import Publication JSON: Open a QuillPress publication JSON file in a new tab
- `dev.inspect` — Inspect Selection: The selected object (or the current page) as JSON, for bug reports and scripts
- `dev.tags` — Object Tags: Edit the selected object's tags (name = value, one per line) for scripts, bookmarks and exports

## Help

Help, shortcuts, command reference, tour, about.

### Help

- `help.about` — About QuillPress
- `help.updates` — Check for Updates: Open the releases page to compare with this version
- `help.commandReference` — Command Reference: Every command, by tab
- `help.help` — Help (F1)
- `help.shortcuts` — Keyboard Shortcuts
- `help.feedback` — Report a Problem / Feedback
- `help.notices` — Third-Party Notices
- `help.tour` — Tour
- `help.whatsNew` — What's New

## Navigation

Page navigation (keyboard and status bar; not on a tab).

### Pages

- `page.first` — First Page (Ctrl+Home)
- `page.goTo` — Go to Page (Ctrl+g)
- `page.last` — Last Page (Ctrl+End)
- `page.next` — Next Page (PageDown, Shift+PageDown)
- `page.nextSpread` — Next Spread (Alt+PageDown)
- `page.prev` — Previous Page (PageUp, Shift+PageUp)
- `page.prevSpread` — Previous Spread (Alt+PageUp)

## Picture (contextual tab)

### Adjust

- `picture.brightness` — Brightness: Brightness of the selected picture (−100 to 100)
- `picture.contrast` — Contrast: Contrast of the selected picture (−100 to 100)
- `picture.grayscale` — Grayscale
- `picture.reset` — Reset Picture: Remove adjustments, cropping and fitting changes
- `picture.saturation` — Saturation: Saturation of the selected picture (−100 to 100)

### Fitting

- `picture.centerInFrame` — Center in Frame: Show the picture at its own size, centered in the frame
- `picture.cropToFrame` — Crop to Frame Proportions: Set the crop so the picture matches the frame exactly without distortion (no hidden area)
- `picture.crop` — Crop: Trim the picture's edges (percent of each side); the frame keeps its size
- `picture.fillFrame` — Fill Frame: Scale the picture to cover the frame, cropping what does not fit
- `picture.fitFrameToPicture` — Fit Frame to Picture: Resize the frame to the picture's proportions (at the current width)
- `picture.fitProportionally` — Fit Proportionally: Scale the whole picture inside the frame
- `picture.fitting` — Fitting *(inspired by Frame fitting options (page layout programs))*
- `picture.actualSize` — Frame to Actual Size: Resize the frame to the picture's own size at its resolution
- `picture.scale` — Picture Scale: Scale and offset of the picture inside the frame

### Picture

- `picture.change` — Change Picture: Replace the picture, keeping the frame and its fitting
- `picture.compress` — Compress Pictures: Re-encode the selected pictures (or all) as JPEG at a chosen resolution to make the file smaller
- `picture.info` — Picture Information
- `picture.place` — Place Picture (Ctrl+Shift+e): Put a picture into the selected frame (or add one)
- `picture.saveAs` — Save Picture As

## Table Design (contextual tab)

### Table Style Options

- `table.bandedRows` — Banded Rows
- `table.firstColumn` — First Column: Bold the first column
- `table.headerRow` — Header Row

### Table Styles

- `table.borders` — Borders
- `table.clearStyle` — Clear Table Style
- `table.headerRepeat` — Header Fill: Color of the header row and of the banding
- `table.innerBorders` — Inner Lines
- `table.shading` — Shading: Fill of the current cell (the arrow picks the color)
- `table.style` — Table Styles

## Table Layout (contextual tab)

### Rows & Columns

- `table.deleteMenu` — Delete
- `table.deleteColumn` — Delete Column
- `table.deleteRow` — Delete Row
- `table.deleteTable` — Delete Table
- `table.insertAbove` — Insert Above
- `table.insertBelow` — Insert Below
- `table.insertLeft` — Insert Left
- `table.insertRight` — Insert Right

### Merge

- `table.merge` — Merge Cells: Merge the current cell with cells to its right and below
- `table.split` — Split Cells: Undo a merge: the merged cells become single cells again

### Cell Size

- `table.columnWidth` — Column Width
- `table.distributeColumns` — Distribute Columns
- `table.distributeRows` — Distribute Rows
- `table.rowHeight` — Row Height

### Data

- `table.cellInsets` — Cell Insets
- `table.toText` — Convert to Text: Replace the table with a text frame (cells separated by tabs)
- `table.editCells` — Edit Cells (Ctrl+Alt+t): Edit the table's text as a grid (one row per line, cells separated by tabs); the cell you choose becomes the current cell for the row/column commands
- `table.sort` — Sort
- `table.fromFrame` — Text Frame to Table: Make a table from the selected frame's paragraphs (tabs or commas separate cells)

### Alignment

- `table.cellAlign` — Vertical Cell Alignment

## Planned, not yet implemented

These ids are reserved for later milestones (see [ROADMAP.md](ROADMAP.md)); they are not in the app yet.

- `text.optMargin` — Optical margin alignment (hanging punctuation)
- `fmt.openTypeFeatures` — OpenType feature switches beyond small caps and ligatures
- `fmt.characterPalette` — Glyph palette from the font
- `page.spreadsMulti` — Spreads of more than two pages (gatefolds)
- `page.alternateLayouts` — Alternate layouts of the same content for other page sizes
- `page.liquidLayout` — Rules that resize frames when the page size changes
- `insert.qrCode` — QR code generation
- `insert.barcode` — Barcodes
- `insert.chart` — Charts from table data
- `insert.crossReference` — Cross-reference to a heading or page
- `picture.clippingPath` — Clipping paths from picture alpha for tight wrap
- `picture.colorProfile` — Color profile tagging
- `shape.booleanOps` — Pathfinder union/subtract/intersect of shapes
- `shape.blend` — Blend modes
- `file.import.pdf` — Place PDF pages as pictures
- `file.export.epub` — Reflowable EPUB export
- `file.export.pdfx` — PDF/X-1a and PDF/X-4 output with embedded fonts
- `file.dataMerge` — Data merge (mail merge) from CSV
- `review.trackChanges` — Track changes in stories
- `review.compareVisual` — Visual page comparison
- `tools.scriptEditor` — A scripting console beyond command macros
- `view.splitWindow` — Two views of one publication side by side
