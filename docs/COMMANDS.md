# QuillPress Command Reference

QuillPress ships **549 commands**. Every one can be placed on the Quick Access Bar, added to a custom tab, bound to a keyboard shortcut, recorded in a macro, or found with command search (Alt+Q).

176 of them are "Commands Not in the Tabs" — reachable through the Quick Access Bar chooser, Customize Tabs, the command search, or menus — so nothing the app can do is hidden.

Of the 572 command ids named in [COMMANDS-PLAN.md](COMMANDS-PLAN.md), 549 are implemented and 23 are not yet; they are listed at the end of this file.

This file is generated from the source by `npm run catalog`; a unit test fails when it is out of date.

## Default tab layout

- **Home**: Clipboard · Styles · Font · Paragraph · Objects · Editing
- **Insert**: Pages · Text · Pictures · Illustrations · Tables · Fields · Symbols · Links
- **Page Design**: Page Setup · Master Pages · Guides and Grids · Numbering · Schemes · Pages
- **Text**: Text Frames · Frame Options · Typography · Paragraph Flow · Notes · Tools
- **Arrange**: Order · Align · Group · Rotate · Text Wrap · Anchor · Size and Position
- **Review**: Proofing · Preflight · Accessibility · Comments · Language · Protect
- **View**: Views · Show · Zoom · Color · Panes · Window · Macros
- **Tools**: Fonts · Pictures · Clean Up · Text · Package
- **AI**: Setup · Create · Write · Design · More · Several AIs
- **Developer**: Code · Data
- **Help**: Help
- **Master Page** (contextual): Edit Master · Master Items · Apply · Close
- **Text Frame** (contextual): Frame · Flow · Notes · Frame Style · Text Wrap · Arrange · Size
- **Picture** (contextual): Adjust · Fitting · Picture · Frame Style · Accessibility · Text Wrap · Arrange · Size
- **Shape** (contextual): Insert Shapes · Shape Styles · Text · Text Wrap · Arrange · Size
- **Line** (contextual): Line · Arrange
- **Text Path** (contextual): Path Text · Path · Font · Arrange · Size
- **Table Design** (contextual): Table Style Options · Table Styles
- **Table Layout** (contextual): Rows & Columns · Merge · Cell Size · Data · Alignment

## File (57)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Close | Close | Ctrl+w, Ctrl+F4 | `file.close` | not in tabs |
| Close All | Close |  | `file.closeAll` | not in tabs |
| Exit | Close |  | `file.exit` | not in tabs |
| Export as Encrypted QuillPress Publication | Export |  | `file.export.qppe` | not in tabs |
| Export as InDesign Markup (IDML) | Export |  | `file.export.idml` | not in tabs |
| Export as QuillPress JSON | Export |  | `file.export.json` | not in tabs |
| Export as QuillPress Publication | Export |  | `file.export.qpp` | not in tabs |
| Export as Scribus Document | Export |  | `file.export.sla` | not in tabs |
| Export Current Page as SVG | Export |  | `file.export.svg` | not in tabs |
| Export Pages as Pictures… | Export |  | `file.export.images` | not in tabs |
| Export Text… | Export |  | `file.export.text` | not in tabs |
| Export to PDF | Export |  | `file.export.pdf` | not in tabs |
| Export Web Page | Export |  | `file.export.html` | not in tabs |
| Package Publication… | Export |  | `file.package` | inspired by Collect for Output (QuarkXPress), Package (InDesign) |
| Encrypt with Password… | Info |  | `file.encrypt` |  |
| Inspect Publication… | Info |  | `file.inspect` | not in tabs |
| Mark as Final | Info |  | `file.markFinal` |  |
| Open Read-Only | Info |  | `file.readOnly` | not in tabs |
| Properties… | Info |  | `file.properties` | not in tabs |
| Recover Unsaved Publications | Info |  | `file.recoverUnsaved` | not in tabs |
| Revert to Saved | Info |  | `file.revert` | not in tabs |
| Take Snapshot | Info | Ctrl+Alt+5 | `file.snapshot` | not in tabs |
| Version History | Info |  | `file.versions` | not in tabs; inspired by Snapshots and version history in writing tools |
| New | New | Ctrl+n | `file.new` | not in tabs |
| New from Template… | New |  | `file.newFromTemplate` | not in tabs |
| New Publication with Page Size… | New |  | `file.newWithSize` | not in tabs |
| Clear Unpinned Recent Publications | Open |  | `file.clearRecent` | not in tabs |
| Import FrameMaker MIF… | Open |  | `file.import.mif` | not in tabs; inspired by Maker Interchange Format (FrameMaker) |
| Import InDesign (IDML)… | Open |  | `file.import.idml` | not in tabs; inspired by IDML interchange (InDesign) |
| Import Publisher, QuarkXPress or PageMaker File… | Open |  | `file.import.layoutFile` | not in tabs |
| Import XPress Tags… | Open |  | `file.import.xpressTags` | not in tabs; inspired by XPress Tags (QuarkXPress) |
| Manual Recovery Options | Open |  | `file.recoveryHelp` | not in tabs |
| Open | Open | Ctrl+o, Ctrl+F12 | `file.open` | not in tabs |
| Open and Repair… | Open |  | `file.openRepair` | not in tabs |
| Open Encrypted Publication… | Open |  | `file.openEncrypted` | not in tabs |
| Open Recent File | Open |  | `file.openRecent` | has options menu; not in tabs |
| Recover Data from Any File… | Open |  | `file.recoverAny` | not in tabs |
| Recovery Report | Open |  | `file.recoveryReport` | not in tabs |
| AutoCorrect Options… | Options |  | `file.autocorrectOptions` | not in tabs |
| Custom Dictionary… | Options |  | `file.customDictionary` | not in tabs |
| Customize Keyboard… | Options |  | `file.customizeKeyboard` | not in tabs |
| Customize Quick Access Bar… | Options |  | `file.customizeQat` | not in tabs |
| Customize Tabs… | Options |  | `file.customizeRibbon` | not in tabs |
| Export / Import Settings… | Options |  | `file.exportSettings` | not in tabs |
| Options… | Options |  | `file.options` | not in tabs |
| Reset All Customizations | Options |  | `file.resetCustomizations` | not in tabs |
| Print Preview and Print | Print | Ctrl+p | `file.print` | not in tabs |
| Quick Print | Print |  | `file.quickPrint` | not in tabs |
| AutoSave | Save |  | `file.autosave` | not in tabs |
| Save | Save | Ctrl+s, Shift+F12 | `file.save` | not in tabs |
| Save a Copy… | Save |  | `file.saveCopy` | not in tabs |
| Save All | Save |  | `file.saveAll` | not in tabs |
| Save As | Save | F12 | `file.saveAs` | not in tabs |
| Save as Template | Save |  | `file.saveTemplate` | not in tabs |
| Email | Share |  | `file.email` | not in tabs |
| Email as PDF | Share |  | `file.emailPdf` | not in tabs |
| Share | Share |  | `file.share` | not in tabs |

## Home (76)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Clipboard | Clipboard |  | `edit.clipboardPane` | not in tabs |
| Copy | Clipboard | Ctrl+c, Ctrl+Insert | `edit.copy` |  |
| Copy Formatting | Clipboard | Ctrl+Shift+c | `edit.copyFormat` | not in tabs |
| Cut | Clipboard | Ctrl+x, Shift+Delete | `edit.cut` |  |
| Duplicate | Clipboard | Ctrl+d | `edit.duplicate` |  |
| Format Painter | Clipboard |  | `edit.formatPainter` |  |
| Paste | Clipboard | Ctrl+v, Shift+Insert | `edit.paste` | has options menu |
| Paste as Picture | Clipboard |  | `edit.pastePicture` | not in tabs |
| Paste Formatting | Clipboard | Ctrl+Shift+v | `edit.pasteFormat` | not in tabs |
| Paste in Place | Clipboard | Ctrl+Alt+Shift+v | `edit.pasteInPlace` | not in tabs; inspired by Paste in Place (page layout programs) |
| Paste Objects | Clipboard |  | `edit.pasteObjects` | not in tabs |
| Paste Special… | Clipboard | Ctrl+Alt+v | `edit.pasteSpecial` | not in tabs |
| Paste: Keep Text Only | Clipboard | Ctrl+Shift+Alt+t | `edit.pasteText` | not in tabs |
| Delete | Editing |  | `edit.delete` | not in tabs |
| Deselect All | Editing | Ctrl+Shift+a | `edit.deselect` | not in tabs |
| Find | Editing | Ctrl+f | `edit.find` |  |
| Go to Object… | Editing |  | `edit.goToObject` | not in tabs |
| Replace | Editing | Ctrl+h | `edit.replace` |  |
| Replace Fonts… | Editing |  | `edit.replaceFonts` |  |
| Select | Editing |  | `edit.selectMenu` | has options menu |
| Select All | Editing | Ctrl+a | `edit.selectAll` | not in tabs |
| Select All Pages | Editing |  | `edit.selectAllPages` | not in tabs |
| Select Next Object | Editing |  | `edit.selectNext` | not in tabs |
| Select Previous Object | Editing |  | `edit.selectPrev` | not in tabs |
| Select Similar | Editing |  | `edit.selectSimilar` | has options menu; not in tabs |
| Bold | Font | Ctrl+b | `fmt.bold` |  |
| Change Case | Font | Shift+F3 | `fmt.changeCase` | has options menu |
| Clear All Formatting | Font | Ctrl+Space | `fmt.clearFormatting` |  |
| Font | Font |  | `fmt.font` |  |
| Font Color | Font |  | `fmt.fontColor` |  |
| Font Size | Font |  | `fmt.fontSize` |  |
| Font… | Font | Ctrl+Shift+f | `fmt.fontDialog` | not in tabs |
| Grow Font | Font | Ctrl+Shift+. | `fmt.growFont` |  |
| Highlight | Font |  | `fmt.highlight` |  |
| Italic | Font | Ctrl+i | `fmt.italic` |  |
| Shrink Font | Font | Ctrl+Shift+, | `fmt.shrinkFont` |  |
| Strikethrough | Font |  | `fmt.strike` |  |
| Subscript | Font | Ctrl+= | `fmt.subscript` |  |
| Superscript | Font | Ctrl+Shift+= | `fmt.superscript` |  |
| Underline | Font | Ctrl+u | `fmt.underline` |  |
| Arrange | Objects |  | `arrange.menu` | has options menu |
| Align Left | Paragraph | Ctrl+l | `fmt.alignLeft` |  |
| Align Right | Paragraph | Ctrl+Shift+r | `fmt.alignRight` |  |
| Bullets | Paragraph | Ctrl+Shift+8 | `fmt.bullets` | has options menu |
| Bullets and Numbering… | Paragraph |  | `fmt.listDialog` | not in tabs |
| Center | Paragraph | Ctrl+e | `fmt.alignCenter` |  |
| Decrease Indent | Paragraph | Ctrl+Shift+m | `fmt.outdent` |  |
| Drop Cap | Paragraph |  | `fmt.dropCap` | has options menu; inspired by Drop caps (Ventura Publisher, PageMaker) |
| Drop Cap Options… | Paragraph |  | `fmt.dropCapDialog` | not in tabs |
| Increase Indent | Paragraph | Ctrl+m | `fmt.indent` |  |
| Justify | Paragraph | Ctrl+j | `fmt.justify` |  |
| Justify All Lines | Paragraph |  | `fmt.justifyAll` | not in tabs |
| Leading | Paragraph |  | `fmt.lineSpacing` | has options menu |
| Numbering | Paragraph | Ctrl+Shift+7 | `fmt.numbering` | has options menu |
| Paragraph Spacing | Paragraph |  | `fmt.paraSpacing` | has options menu |
| Paragraph… | Paragraph | Ctrl+Alt+m | `fmt.paragraphDialog` |  |
| Restart Numbering | Paragraph |  | `fmt.restartNumbering` | not in tabs |
| Character Styles | Styles |  | `fmt.charStyle` | has options menu |
| Delete Character Style… | Styles |  | `fmt.deleteCharStyle` | not in tabs |
| Delete Paragraph Style… | Styles |  | `fmt.deleteStyle` | not in tabs |
| Duplicate Character Style | Styles |  | `fmt.duplicateCharStyle` | not in tabs |
| Duplicate Paragraph Style | Styles |  | `fmt.duplicateStyle` | not in tabs |
| Load Styles from Publication… | Styles |  | `fmt.importStyles` | not in tabs; inspired by Load Styles (page layout programs) |
| Modify Character Style… | Styles |  | `fmt.modifyCharStyle` | not in tabs |
| Modify Paragraph Style… | Styles |  | `fmt.modifyParaStyle` | not in tabs |
| New Character Style… | Styles |  | `fmt.newCharStyle` | not in tabs |
| New Paragraph Style… | Styles |  | `fmt.newParaStyle` | not in tabs |
| Paragraph Styles | Styles |  | `fmt.paraStyle` | has options menu |
| Redefine Character Style from Selection | Styles |  | `fmt.redefineCharStyle` | not in tabs |
| Redefine Style from Selection | Styles |  | `fmt.redefineStyle` | not in tabs; inspired by Redefine style (page layout programs) |
| Select Frames by Style… | Styles |  | `fmt.selectByStyle` | not in tabs |
| Style Inheritance… | Styles |  | `fmt.styleChain` | not in tabs |
| Styles | Styles | F11 | `fmt.stylesPane` |  |
| Redo | Undo | Ctrl+y, Ctrl+Shift+z, F4 | `edit.redo` | not in tabs |
| Repeat | Undo |  | `edit.repeat` | not in tabs |
| Undo | Undo | Ctrl+z | `edit.undo` | has options menu; not in tabs |

## Insert (44)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Date and Time | Fields |  | `insert.dateTime` | has options menu |
| Next Page Number | Fields |  | `insert.nextPage` |  |
| Previous Page Number | Fields |  | `insert.prevPage` |  |
| Publication Title | Fields |  | `insert.titleField` |  |
| Text Variable | Fields |  | `insert.variable` | has options menu; inspired by Text variables (FrameMaker) |
| Arrow | Illustrations |  | `insert.arrow` | has options menu |
| Arrow Line | Illustrations |  | `insert.arrowLine` | not in tabs |
| Ellipse | Illustrations | l | `insert.ellipse` |  |
| Line | Illustrations | \ | `insert.line` |  |
| Polygon | Illustrations |  | `insert.polygon` | has options menu |
| Rectangle | Illustrations | m | `insert.rectangle` |  |
| Shapes | Illustrations |  | `insert.shape` | has options menu |
| Star | Illustrations |  | `insert.star` | has options menu |
| Bookmark | Links |  | `insert.bookmark` |  |
| Comment | Links |  | `insert.comment` |  |
| Generate Index | Links |  | `insert.index` | not in tabs |
| Index Entry | Links |  | `insert.indexMarker` | inspired by Index markers (Ventura Publisher, FrameMaker) |
| Link | Links | Ctrl+k | `insert.link` |  |
| Remove Link | Links |  | `insert.removeLink` |  |
| Page Count | Pages |  | `insert.pageCount` |  |
| Page Number | Pages | Ctrl+Alt+Shift+n | `insert.pageNumber` |  |
| Section Name | Pages |  | `insert.sectionMarker` |  |
| Picture | Pictures | Ctrl+Shift+i | `insert.picture` |  |
| Picture Frame | Pictures | f | `insert.pictureFrame` | inspired by Picture boxes (QuarkXPress) |
| Picture from Web Address… | Pictures |  | `insert.pictureFromUrl` |  |
| Screenshot | Pictures |  | `insert.screenshot` |  |
| Code Block | Symbols |  | `insert.codeBlock` |  |
| Emoji | Symbols |  | `insert.emoji` |  |
| Equation | Symbols |  | `insert.equation` |  |
| Special Characters | Symbols |  | `insert.specialChar` | has options menu |
| Symbol | Symbols |  | `insert.symbol` |  |
| Draw Table | Tables |  | `insert.drawTable` |  |
| Table | Tables |  | `insert.table` |  |
| Table from Text… | Tables |  | `insert.tableFromText` |  |
| Caption | Text |  | `insert.caption` |  |
| Inline Picture | Text |  | `insert.inlinePicture` | inspired by Inline graphics (PageMaker, Ventura Publisher) |
| Inline Text Frame | Text |  | `insert.inlineFrame` |  |
| Place Text File… | Text | Ctrl+Shift+d | `insert.textFile` | inspired by Place (PageMaker), Get Text (QuarkXPress) |
| Placeholder Text | Text |  | `insert.placeholderText` | inspired by Lorem ipsum fill (page layout programs) |
| Pull Quote | Text |  | `insert.pullQuote` | inspired by Pull quotes (magazine layout) |
| Sidebar | Text |  | `insert.sidebar` |  |
| Table of Contents | Text |  | `insert.toc` | inspired by Generated contents (Ventura Publisher, FrameMaker) |
| Text Frame | Text | Ctrl+Shift+t, t | `insert.textFrame` |  |
| Text on a Path | Text |  | `insert.textOnPath` | has options menu; inspired by Text on a path (CorelDRAW, Illustrator, InDesign) |

## Page Design (46)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Add Guide | Guides and Grids |  | `page.addGuide` | has options menu |
| Baseline Grid… | Guides and Grids |  | `page.baselineGrid` | inspired by Baseline grids (magazine layout) |
| Clear Guides | Guides and Grids |  | `page.clearGuides` |  |
| Guides… | Guides and Grids |  | `page.guidesDialog` |  |
| Layout Guides… | Guides and Grids |  | `page.layoutGuides` | inspired by Layout guides (Microsoft Publisher), Create Guides (InDesign) |
| Lock Guides | Guides and Grids |  | `page.lockGuides` |  |
| Apply Master | Master Pages |  | `page.applyMaster` | has options menu |
| Apply Master to All Pages | Master Pages |  | `page.applyMasterAll` |  |
| Close Master Page | Master Pages |  | `page.closeMaster` |  |
| Delete Master… | Master Pages |  | `page.deleteMaster` |  |
| Duplicate Master | Master Pages |  | `page.duplicateMaster` |  |
| Edit Master Page | Master Pages | Ctrl+Shift+m | `page.editMaster` | has options menu |
| Hide Master Items | Master Pages |  | `page.hideMasterItems` | not in tabs |
| Master Options… | Master Pages |  | `page.masterOptions` |  |
| New Master… | Master Pages |  | `page.newMaster` |  |
| Override Master Item | Master Pages |  | `page.overrideMasterItem` | not in tabs; inspired by Master item overrides (page layout programs) |
| Rename Master… | Master Pages |  | `page.renameMaster` |  |
| Page Numbering… | Numbering |  | `page.numbering` |  |
| Sections… | Numbering |  | `page.sections` |  |
| Text Variables… | Numbering |  | `page.variables` |  |
| Bleed | Page Setup |  | `page.bleed` | inspired by Bleed and slug (prepress) |
| Columns | Page Setup |  | `page.columns` | has options menu |
| Facing Pages | Page Setup |  | `page.facing` |  |
| Margins | Page Setup |  | `page.margins` | has options menu |
| Orientation | Page Setup |  | `page.orientation` | has options menu |
| Page Setup… | Page Setup | Ctrl+Alt+p | `page.setupDialog` | not in tabs |
| Page Size | Page Setup |  | `page.size` | has options menu |
| Delete Page | Pages |  | `page.delete` |  |
| Duplicate Page | Pages |  | `page.duplicate` |  |
| Insert Page | Pages | Ctrl+Shift+p | `page.insert` |  |
| Insert Page Before | Pages |  | `page.insertBefore` |  |
| Insert Pages… | Pages |  | `page.insertMany` |  |
| Move Page Down | Pages | Ctrl+Alt+ArrowDown | `page.moveDown` | not in tabs |
| Move Page Up | Pages | Ctrl+Alt+ArrowUp | `page.moveUp` | not in tabs |
| Move Page… | Pages |  | `page.move` |  |
| Name Page… | Pages |  | `page.rename` |  |
| Page Notes… | Pages |  | `page.notes` | not in tabs |
| Apply Template… | Schemes |  | `page.applyTemplate` |  |
| Color Scheme | Schemes |  | `page.colorScheme` | has options menu; inspired by Color schemes (Microsoft Publisher) |
| Delete Swatch… | Schemes |  | `page.deleteSwatch` | not in tabs |
| Duplicate Swatch | Schemes |  | `page.duplicateSwatch` | not in tabs |
| Edit Swatch… | Schemes |  | `page.editSwatch` | not in tabs |
| Font Scheme | Schemes |  | `page.fontScheme` | has options menu; inspired by Font schemes (Microsoft Publisher) |
| New Swatch… | Schemes |  | `page.newSwatch` | not in tabs |
| Page Background | Schemes |  | `page.background` |  |
| Swatches | Schemes | F5 | `page.swatchesPane` |  |

## Text (65)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Auto-Size Height | Frame Options |  | `text.autosize` |  |
| Fit Frame to Text | Frame Options | Ctrl+Alt+c | `text.fitFrameToText` | not in tabs |
| Frame Columns | Frame Options |  | `text.columns` | has options menu |
| Ignore Text Wrap | Frame Options |  | `text.ignoreWrap` |  |
| Insets | Frame Options |  | `text.insets` | has options menu |
| Text Frame Options… | Frame Options | Ctrl+Alt+b | `text.frameOptions` |  |
| Vertical Alignment | Frame Options |  | `text.verticalAlign` | has options menu |
| Vertical Text | Frame Options |  | `text.vertical` | not in tabs |
| Delete Footnote | Notes |  | `text.deleteFootnote` |  |
| Edit Footnote | Notes |  | `text.editFootnote` |  |
| Endnotes to Footnotes | Notes |  | `text.endnotesToFootnotes` |  |
| Footnote Options… | Notes |  | `text.footnoteOptions` | not in tabs |
| Footnotes | Notes |  | `text.footnotesPane` |  |
| Footnotes to Endnotes | Notes |  | `text.footnotesToEndnotes` |  |
| Go to Reference | Notes |  | `text.goToReference` |  |
| Insert Footnote | Notes | Ctrl+Alt+f | `text.insertFootnote` | inspired by Footnotes (Ventura Publisher, FrameMaker, InDesign) |
| Next Footnote | Notes |  | `text.nextFootnote` |  |
| Previous Footnote | Notes |  | `text.prevFootnote` |  |
| Keep Lines Together | Paragraph Flow |  | `fmt.keepLines` |  |
| Keep with Next | Paragraph Flow |  | `fmt.keepWithNext` |  |
| Rule Above | Paragraph Flow |  | `fmt.ruleAbove` | has options menu; inspired by Paragraph rules (Ventura Publisher) |
| Rule Below | Paragraph Flow |  | `fmt.ruleBelow` | has options menu |
| Autoflow | Text Frames |  | `text.autoflow` | inspired by Autoflow (PageMaker) |
| Link Frames | Text Frames | Ctrl+Shift+l | `text.link` | inspired by Linked text frames (Ventura, PageMaker, QuarkXPress) |
| Next Frame in Story | Text Frames | Ctrl+Alt+PageDown | `text.nextFrame` |  |
| Previous Frame in Story | Text Frames | Ctrl+Alt+PageUp | `text.prevFrame` |  |
| Split Story Here | Text Frames |  | `text.splitStory` |  |
| Text Threads | Text Frames |  | `text.threadsPane` |  |
| Unlink Frame | Text Frames |  | `text.unlink` |  |
| Change Case | Tools |  | `text.changeCase` | has options menu |
| Clear Story Text | Tools |  | `text.clearStory` | not in tabs |
| Edit Text | Tools | F2 | `text.editText` | not in tabs |
| Fill with Placeholder Text | Tools |  | `text.insertLorem` |  |
| Fit Copy | Tools |  | `text.fitCopy` | has options menu; inspired by Copy fitting (QuarkXPress, Ventura) |
| Name Story… | Tools |  | `text.storyName` | not in tabs |
| Overset Text | Tools |  | `text.oversetReport` |  |
| Report Needed Height | Tools |  | `text.neededHeight` | not in tabs |
| Scale Type… | Tools |  | `text.scaleType` | not in tabs |
| Story Editor | Tools | Ctrl+y | `text.storyEditor` | inspired by Story Editor (PageMaker), Story Editor (Scribus) |
| Text to New Frame | Tools |  | `text.newStoryFromSelection` | not in tabs |
| Word Count | Tools |  | `text.wordCount` |  |
| Add Font Files… | Typography |  | `fonts.add` | not in tabs |
| Align to Baseline Grid | Typography |  | `fmt.baselineGridAlign` |  |
| All Caps | Typography | Ctrl+Shift+a | `fmt.allCaps` |  |
| Baseline Shift | Typography |  | `fmt.baselineShift` |  |
| Baseline Shift (pt) | Typography |  | `fmt.baselineShiftPoints` | inspired by Baseline shift (QuarkXPress, PageMaker) |
| Fonts Used Report | Typography |  | `fonts.usedReport` | not in tabs |
| Fonts… | Typography |  | `fonts.manage` |  |
| Forget Packaged Fonts | Typography |  | `fonts.unpackage` | not in tabs |
| Horizontal Scale | Typography |  | `fmt.hscale` | inspired by Horizontal scale (QuarkXPress, PageMaker set width) |
| Hyphenate | Typography |  | `fmt.hyphenation` | inspired by TeX hyphenation |
| Install Packaged Fonts | Typography |  | `fonts.installPackaged` | not in tabs |
| Kerning | Typography |  | `fmt.kerning` |  |
| Ligatures | Typography |  | `fmt.ligatures` |  |
| Optical Margin Alignment | Typography |  | `fmt.opticalMargin` | inspired by Hanging punctuation (Gutenberg; InDesign optical margin alignment) |
| Optical Margin Size… | Typography |  | `text.opticalMarginSize` |  |
| Optical Margins for Story | Typography |  | `text.opticalMarginStory` |  |
| Outline | Typography |  | `fmt.outline` | inspired by Outline type style (Macintosh, QuarkXPress, PageMaker) |
| Package Fonts | Typography |  | `fonts.package` | not in tabs |
| Remove Font… | Typography |  | `fonts.remove` | not in tabs |
| Shadow | Typography |  | `fmt.textShadow` | inspired by Shadow type style (Macintosh, QuarkXPress, PageMaker) |
| Small Caps | Typography | Ctrl+Shift+k | `fmt.smallCaps` |  |
| Tabs… | Typography |  | `fmt.tabs` |  |
| Text Language | Typography |  | `fmt.language` | not in tabs |
| Tracking | Typography |  | `fmt.tracking` |  |

## Arrange (82)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Align | Align |  | `arrange.align` | has options menu |
| Align Bottom | Align |  | `arrange.alignBottom` |  |
| Align Center | Align |  | `arrange.alignCenter` |  |
| Align Left | Align |  | `arrange.alignLeft` |  |
| Align Middle | Align |  | `arrange.alignMiddle` |  |
| Align Right | Align |  | `arrange.alignRight` |  |
| Align to Margins | Align |  | `arrange.alignToMargins` | has options menu; not in tabs |
| Align to Page | Align |  | `arrange.alignToPage` |  |
| Align Top | Align |  | `arrange.alignTop` |  |
| Center on Page | Align |  | `arrange.centerOnPage` | not in tabs |
| Distribute Horizontally | Align |  | `arrange.distributeH` |  |
| Distribute Vertically | Align |  | `arrange.distributeV` |  |
| Anchor Above Line | Anchor |  | `arrange.anchorAbove` |  |
| Anchor at Offset | Anchor |  | `arrange.anchorCustom` |  |
| Anchor Inline | Anchor |  | `arrange.anchorInline` | inspired by Inline graphics (PageMaker, Ventura, InDesign anchored objects) |
| Anchor Options… | Anchor |  | `arrange.anchorOptions` | not in tabs |
| Release Anchor | Anchor |  | `arrange.releaseAnchor` |  |
| Group | Group | Ctrl+Shift+g | `arrange.group` |  |
| Hide | Group | Ctrl+3 | `arrange.hide` |  |
| Lock | Group | Ctrl+Alt+l | `arrange.lock` |  |
| Show All on Page | Group | Ctrl+Alt+3 | `arrange.showAll` |  |
| Ungroup | Group | Ctrl+Alt+Shift+g | `arrange.ungroup` |  |
| Unlock All on Page | Group |  | `arrange.unlockAll` |  |
| Bring Forward | Order | Ctrl+] | `arrange.bringForward` |  |
| Bring to Front | Order | Ctrl+Shift+] | `arrange.bringToFront` |  |
| Send Backward | Order | Ctrl+[ | `arrange.sendBackward` |  |
| Send to Back | Order | Ctrl+Shift+[ | `arrange.sendToBack` |  |
| Flip Horizontal | Rotate |  | `arrange.flipH` |  |
| Flip Vertical | Rotate |  | `arrange.flipV` |  |
| Rotate | Rotate |  | `arrange.rotate` | has options menu |
| Rotate Left 90° | Rotate |  | `arrange.rotateLeft` |  |
| Rotate Right 90° | Rotate |  | `arrange.rotateRight` |  |
| Skew | Rotate |  | `arrange.skew` | has options menu; inspired by Skew (QuarkXPress, PageMaker) |
| Apply Swatch | Shape |  | `shape.applySwatch` | not in tabs |
| Change Shape | Shape |  | `shape.change` | has options menu |
| Convert to Picture Frame | Shape |  | `shape.convertToPicture` | not in tabs |
| Convert to Text Frame | Shape |  | `shape.convertToText` |  |
| Corner Rounding… | Shape |  | `shape.corners` | not in tabs |
| Delete Object Style… | Shape |  | `shape.deleteObjectStyle` | not in tabs |
| Duplicate Object Style | Shape |  | `shape.duplicateObjectStyle` | not in tabs |
| Edit Points… | Shape |  | `shape.editPoints` |  |
| Effects | Shape |  | `shape.effects` | has options menu |
| Fill | Shape |  | `shape.fill` |  |
| Gradient Fill… | Shape |  | `shape.gradient` | not in tabs |
| Line Dash | Shape |  | `shape.lineDash` | has options menu |
| Line Ends | Shape |  | `shape.lineEnds` | has options menu |
| Line Width | Shape |  | `shape.lineWidth` |  |
| Modify Object Style… | Shape |  | `shape.modifyObjectStyle` | not in tabs |
| Name Object… | Shape |  | `shape.name` | not in tabs |
| New Object Style… | Shape |  | `shape.newObjectStyle` | not in tabs |
| Object Styles | Shape |  | `shape.objectStyle` | has options menu |
| Outline | Shape |  | `shape.outline` |  |
| Outline Color | Shape |  | `shape.outlineColor` | not in tabs |
| Picture Fill… | Shape |  | `shape.pictureFill` | not in tabs |
| Redefine Object Style from Selection | Shape |  | `shape.redefineObjectStyle` | not in tabs |
| Transparency | Shape |  | `shape.transparency` |  |
| Height | Size |  | `shape.height` |  |
| Width | Size |  | `shape.width` |  |
| Delete Layer… | Size and Position |  | `arrange.deleteLayer` | not in tabs |
| Layer Options… | Size and Position |  | `arrange.layerOptions` | not in tabs |
| Layers | Size and Position |  | `arrange.layersPane` |  |
| Make Same Size | Size and Position |  | `arrange.makeSameSize` | has options menu |
| Move to Layer | Size and Position |  | `arrange.moveToLayer` | has options menu |
| New Layer… | Size and Position |  | `arrange.newLayer` | not in tabs |
| Size and Position… | Size and Position | Ctrl+Shift+s | `arrange.sizeDialog` |  |
| Step and Repeat… | Size and Position | Ctrl+Alt+u | `arrange.stepRepeat` | inspired by Step and Repeat (QuarkXPress, InDesign) |
| Align on Path | Text Path |  | `path.align` | has options menu |
| Baseline Shift… | Text Path |  | `path.baseline` |  |
| Character Spacing… | Text Path |  | `path.spacing` |  |
| Edit Path Text… | Text Path |  | `path.editText` |  |
| Flip to Other Side | Text Path |  | `path.flip` |  |
| From Shape | Text Path |  | `path.fromShape` |  |
| Release to Text Frame | Text Path |  | `path.release` |  |
| Show Path | Text Path |  | `path.showPath` |  |
| Start Offset… | Text Path |  | `path.offset` |  |
| Behind Text | Text Wrap |  | `arrange.wrapBehind` | not in tabs |
| Jump Object | Text Wrap |  | `arrange.wrapTopBottom` |  |
| No Wrap | Text Wrap |  | `arrange.wrapNone` |  |
| Text Wrap | Text Wrap |  | `arrange.wrap` | has options menu; inspired by Text wrap / runaround (PageMaker, QuarkXPress) |
| Wrap Around Bounding Box | Text Wrap |  | `arrange.wrapSquare` |  |
| Wrap Around Shape | Text Wrap |  | `arrange.wrapTight` |  |
| Wrap Distance… | Text Wrap |  | `arrange.wrapOffset` |  |

## Review (21)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Alt Text | Accessibility |  | `review.altText` |  |
| Check Accessibility | Accessibility |  | `review.checkAccessibility` |  |
| Mark as Decorative | Accessibility |  | `review.decorative` |  |
| Comments | Comments |  | `review.commentsPane` |  |
| Delete All Comments | Comments |  | `review.deleteAllComments` | not in tabs |
| Delete Comment | Comments |  | `review.deleteComment` |  |
| New Comment | Comments | Ctrl+Alt+m | `review.newComment` |  |
| Next Comment | Comments |  | `review.nextComment` |  |
| Previous Comment | Comments |  | `review.prevComment` |  |
| Language | Language |  | `review.language` | has options menu |
| Look Up | Language |  | `review.lookUp` |  |
| Translate | Language |  | `review.translate` |  |
| Fonts Used | Preflight |  | `review.fontsUsed` |  |
| Pictures Pane | Preflight |  | `review.linksPane` |  |
| Preflight | Preflight | Ctrl+Alt+Shift+f | `review.preflight` | inspired by Preflight (prepress), Design Checker (Microsoft Publisher) |
| Preflight Pane | Preflight |  | `review.preflightPane` |  |
| Compare with File… | Proofing |  | `review.compare` | not in tabs |
| Dictionaries… | Proofing |  | `review.dictionaries` |  |
| Reading Level | Proofing |  | `review.readingLevel` |  |
| Spelling | Proofing | F7 | `review.spelling` |  |
| Statistics | Proofing |  | `review.statistics` |  |

## View (39)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Dark Mode | Appearance |  | `view.theme` | has options menu; not in tabs |
| Measurement Unit | Appearance |  | `view.unit` | has options menu; not in tabs |
| Color | Color |  | `view.color` |  |
| Grayscale | Color |  | `view.grayscale` |  |
| Search Commands | Help | Alt+q | `view.cmdSearch` | not in tabs |
| Layers | Panes | Alt+F10 | `view.layersPane` |  |
| Navigator | Panes |  | `view.navigator` | inspired by Navigator panes in office suites |
| Add All Quick Access Choices (A–Z) | Quick Access Bar |  | `view.qatAddAll` | not in tabs |
| Hide Quick Access Bar | Quick Access Bar |  | `view.qatHide` | not in tabs |
| Quick Access Bar Labels | Quick Access Bar |  | `view.qatLabels` | not in tabs |
| Quick Access Bar Position | Quick Access Bar |  | `view.qatPosition` | has options menu; not in tabs |
| Show Quick Access Bar | Quick Access Bar |  | `view.qatShow` | not in tabs |
| Collapse the Ribbon | Ribbon | Ctrl+F1 | `view.collapseRibbon` | not in tabs |
| Touch/Mouse Mode | Ribbon |  | `view.touchMode` | not in tabs |
| Baseline Grid | Show | Ctrl+Alt+' | `view.baselineGrid` |  |
| Document Grid | Show | Ctrl+' | `view.grid` |  |
| Frame Edges | Show | Ctrl+Alt+h | `view.frameEdges` |  |
| Grids and Guides… | Show |  | `view.gridSettings` | not in tabs |
| Guides | Show | Ctrl+; | `view.guides` |  |
| Pages Pane | Show |  | `view.pagesPane` |  |
| Rulers | Show | Ctrl+r | `view.rulers` |  |
| Smart Guides | Show |  | `view.smartGuides` | not in tabs |
| Snap to Grid | Show |  | `view.snapToGrid` | not in tabs |
| Snap to Guides | Show |  | `view.snapToGuides` | not in tabs |
| Text Threads | Show | Ctrl+Alt+y | `view.textThreads` |  |
| Preview | Views | Ctrl+Shift+w | `view.previewMode` |  |
| Single Page | Views |  | `view.single` |  |
| Spreads | Views |  | `view.spread` |  |
| Full Screen | Window |  | `view.fullScreen` |  |
| New Window | Window |  | `view.newWindow` |  |
| Status Bar | Window |  | `view.statusBar` | not in tabs |
| Switch Windows | Window | Ctrl+F6 | `view.switchWindow` | has options menu |
| Actual Size | Zoom | Ctrl+1 | `view.actualSize` |  |
| Fit Page | Zoom | Ctrl+0 | `view.fitPage` |  |
| Fit Width | Zoom | Ctrl+Alt+0 | `view.fitWidth` |  |
| Zoom | Zoom |  | `view.zoom` |  |
| Zoom In | Zoom | Ctrl+= | `view.zoomIn` |  |
| Zoom Out | Zoom | Ctrl+- | `view.zoomOut` |  |
| Zoom to Selection | Zoom | Ctrl+Alt+= | `view.zoomSelection` | not in tabs |

## Tools (17)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Empty Frames | Clean Up |  | `tools.emptyFrames` | has options menu |
| Objects Off the Page | Clean Up |  | `tools.offPage` | has options menu |
| Remove Unused Styles | Clean Up |  | `tools.unusedStyles` |  |
| Remove Unused Swatches | Clean Up |  | `tools.unusedSwatches` |  |
| Reset Master Items | Clean Up |  | `tools.resetMasterItems` |  |
| Find Font… | Fonts |  | `tools.findFont` | inspired by Find Font (page layout programs) |
| Booklet Order | Package |  | `tools.imposition` | not in tabs; inspired by Imposition (prepress) |
| Print Checklist | Package |  | `tools.packageChecklist` |  |
| Printer's Marks… | Package |  | `tools.printerMarks` |  |
| Compress Pictures… | Pictures |  | `tools.compressPictures` |  |
| Extract Pictures… | Pictures |  | `tools.extractMedia` |  |
| Low-Resolution Pictures | Pictures |  | `tools.lowResReport` |  |
| Relink Picture… | Pictures |  | `tools.relink` |  |
| Clean Up Pasted Text… | Text |  | `tools.ocrCleanup` |  |
| Fill Empty Frames with Placeholder | Text |  | `tools.fillWithPlaceholder` |  |
| Split Story into Frames | Text |  | `tools.textToFrames` |  |
| Typographer's Quotes | Text |  | `tools.convertQuotes` | inspired by Convert Quotes (Ventura, PageMaker) |

## AI (29)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Draft Publication | Create |  | `ai.draftPublication` |  |
| Draft Story | Create |  | `ai.draftStory` |  |
| Suggest Deck | Create |  | `ai.decks` | not in tabs |
| Suggest Headlines | Create |  | `ai.headlines` |  |
| Suggest Pull Quotes | Create |  | `ai.pullQuotes` |  |
| Write Caption | Create |  | `ai.captions` |  |
| Generate Alt Text | Design |  | `ai.altText` |  |
| Layout Suggestions | Design |  | `ai.layoutSuggestions` |  |
| Suggest Styles | Design |  | `ai.styleNames` |  |
| Summary Box | Design |  | `ai.summarize` |  |
| AI Assistant | More |  | `ai.assistant` |  |
| Prompt Library | More |  | `ai.prompts` | has options menu |
| Active AI | Setup |  | `ai.active` | has options menu |
| AI & Privacy | Setup |  | `ai.privacy` |  |
| AI Settings | Setup |  | `ai.settings` |  |
| Delete Downloaded Models | Setup |  | `ai.deleteModels` | not in tabs |
| Providers & Models | Setup |  | `ai.providers` |  |
| Set Up AI | Setup |  | `ai.setup` |  |
| Stop AI | Setup |  | `ai.stop` |  |
| Choose AIs | Several AIs |  | `ai.ensembleMembers` |  |
| Several AIs | Several AIs |  | `ai.ensembleMode` | has options menu |
| Show AI Discussion | Several AIs |  | `ai.showDeliberation` |  |
| Change Tone | Write |  | `ai.tone` |  |
| Expand | Write |  | `ai.expand` |  |
| Fit Copy by Rewriting | Write |  | `ai.fitCopy` | inspired by Copy fitting by editors |
| Proofread | Write |  | `ai.proofread` |  |
| Rewrite | Write |  | `ai.rewrite` |  |
| Shorten | Write |  | `ai.shorten` |  |
| Translate | Write |  | `ai.translate` |  |

## Developer (9)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Macro Editor | Code |  | `dev.macroEditor` |  |
| Macro Security | Code |  | `dev.macroSecurity` |  |
| Macros | Code | Alt+F8 | `dev.macros` |  |
| Record Macro | Code |  | `dev.recordMacro` |  |
| Stop Recording | Code |  | `dev.stopRecording` | not in tabs |
| Export Publication JSON | Data |  | `dev.exportJson` |  |
| Import Publication JSON | Data |  | `dev.importJson` |  |
| Inspect Selection | Data |  | `dev.inspect` |  |
| Object Tags | Data |  | `dev.tags` |  |

## Help (9)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| About QuillPress | Help |  | `help.about` |  |
| Check for Updates | Help |  | `help.updates` | not in tabs |
| Command Reference | Help |  | `help.commandReference` |  |
| Help | Help | F1 | `help.help` |  |
| Keyboard Shortcuts | Help |  | `help.shortcuts` |  |
| Report a Problem / Feedback | Help |  | `help.feedback` |  |
| Third-Party Notices | Help |  | `help.notices` |  |
| Tour | Help |  | `help.tour` |  |
| What's New | Help |  | `help.whatsNew` |  |

## Navigation (7)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| First Page | Pages | Ctrl+Home | `page.first` | not in tabs |
| Go to Page… | Pages | Ctrl+g | `page.goTo` | not in tabs |
| Last Page | Pages | Ctrl+End | `page.last` | not in tabs |
| Next Page | Pages | PageDown, Shift+PageDown | `page.next` | not in tabs |
| Next Spread | Pages | Alt+PageDown | `page.nextSpread` | not in tabs |
| Previous Page | Pages | PageUp, Shift+PageUp | `page.prev` | not in tabs |
| Previous Spread | Pages | Alt+PageUp | `page.prevSpread` | not in tabs |

## Picture (contextual) (19)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Brightness | Adjust |  | `picture.brightness` |  |
| Contrast | Adjust |  | `picture.contrast` |  |
| Grayscale | Adjust |  | `picture.grayscale` |  |
| Reset Picture | Adjust |  | `picture.reset` |  |
| Saturation | Adjust |  | `picture.saturation` |  |
| Center in Frame | Fitting |  | `picture.centerInFrame` |  |
| Crop to Frame Proportions | Fitting |  | `picture.cropToFrame` | not in tabs |
| Crop… | Fitting |  | `picture.crop` |  |
| Fill Frame | Fitting |  | `picture.fillFrame` |  |
| Fit Frame to Picture | Fitting |  | `picture.fitFrameToPicture` |  |
| Fit Proportionally | Fitting |  | `picture.fitProportionally` |  |
| Fitting | Fitting |  | `picture.fitting` | has options menu; inspired by Frame fitting options (page layout programs) |
| Frame to Actual Size | Fitting |  | `picture.actualSize` | not in tabs |
| Picture Scale… | Fitting |  | `picture.scale` | not in tabs |
| Change Picture… | Picture |  | `picture.change` |  |
| Compress Pictures… | Picture |  | `picture.compress` |  |
| Picture Information | Picture |  | `picture.info` |  |
| Place Picture… | Picture | Ctrl+Shift+e | `picture.place` |  |
| Save Picture As… | Picture |  | `picture.saveAs` |  |

## Table Design (contextual) (9)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Banded Rows | Table Style Options |  | `table.bandedRows` |  |
| First Column | Table Style Options |  | `table.firstColumn` |  |
| Header Row | Table Style Options |  | `table.headerRow` |  |
| Borders | Table Styles |  | `table.borders` | has options menu |
| Clear Table Style | Table Styles |  | `table.clearStyle` |  |
| Header Fill… | Table Styles |  | `table.headerRepeat` | not in tabs |
| Inner Lines | Table Styles |  | `table.innerBorders` |  |
| Shading | Table Styles |  | `table.shading` |  |
| Table Styles | Table Styles |  | `table.style` | has options menu |

## Table Layout (contextual) (20)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Vertical Cell Alignment | Alignment |  | `table.cellAlign` | has options menu |
| Column Width | Cell Size |  | `table.columnWidth` |  |
| Distribute Columns | Cell Size |  | `table.distributeColumns` |  |
| Distribute Rows | Cell Size |  | `table.distributeRows` |  |
| Row Height | Cell Size |  | `table.rowHeight` |  |
| Cell Insets… | Data |  | `table.cellInsets` |  |
| Convert to Text | Data |  | `table.toText` |  |
| Edit Cells… | Data | Ctrl+Alt+t | `table.editCells` |  |
| Sort… | Data |  | `table.sort` |  |
| Text Frame to Table | Data |  | `table.fromFrame` | not in tabs |
| Merge Cells | Merge |  | `table.merge` |  |
| Split Cells | Merge |  | `table.split` |  |
| Delete | Rows & Columns |  | `table.deleteMenu` | has options menu |
| Delete Column | Rows & Columns |  | `table.deleteColumn` | not in tabs |
| Delete Row | Rows & Columns |  | `table.deleteRow` | not in tabs |
| Delete Table | Rows & Columns |  | `table.deleteTable` | not in tabs |
| Insert Above | Rows & Columns |  | `table.insertAbove` |  |
| Insert Below | Rows & Columns |  | `table.insertBelow` |  |
| Insert Left | Rows & Columns |  | `table.insertLeft` |  |
| Insert Right | Rows & Columns |  | `table.insertRight` |  |

## Planned, not yet implemented (23)

These ids are in the plan but have no command yet. A command is only registered when it works; nothing below is a placeholder in the app.

- **area**: `area.name`
- **file**: `file.dataMerge`, `file.export.epub`, `file.export.pdfx`, `file.import.pdf`
- **fmt**: `fmt.characterPalette`, `fmt.openTypeFeatures`
- **insert**: `insert.barcode`, `insert.chart`, `insert.crossReference`, `insert.qrCode`
- **page**: `page.alternateLayouts`, `page.liquidLayout`, `page.spreadsMulti`
- **picture**: `picture.clippingPath`, `picture.colorProfile`
- **review**: `review.compareVisual`, `review.trackChanges`
- **shape**: `shape.blend`, `shape.booleanOps`
- **text**: `text.optMargin`
- **tools**: `tools.scriptEditor`
- **view**: `view.splitWindow`
