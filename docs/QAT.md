# Quick Access Bar

The Quick Access Bar (QAT) offers everything a desktop page layout program puts on its Quick Access Toolbar, and more. It follows the implementation shared by the Quill apps (`QAT_STANDARD`, `QAT_EXTRAS`, `addAllQatChoices` in `src/prefs.ts`).

## Principles

- Every command is eligible. The QAT stores command ids; any of the commands in [COMMANDS.md](COMMANDS.md), plus macros (`macro:<name>`) and separators (`|`), can be placed on it.
- The drop-down arrow at the end of the bar offers the **standard choices** as a checklist, so the common ones are one tap away without opening a dialog.
- QuillPress's checklist is the **union** of the choices the desktop office programs have offered across their versions, plus publishing extras. Nothing that any version offered is left out.
- The bar can sit at the top, below the ribbon, or **at the bottom near the on-screen keyboard** (a Quill suite innovation), and can show or hide command labels.

## The desktop drop-down choices

The *Customize Quick Access Toolbar* drop-down of the desktop office programs offers, across versions: AutoSave, New, Open, Save, Email, Quick Print, Print Preview and Print, Spelling, Undo, Redo, Open Recent File, Touch/Mouse Mode, More Commands…, Show Below/Above the Ribbon, Minimize/Collapse the Ribbon, Hide Quick Access Toolbar, and Show/Hide command labels. Presentation programs add *Start from Beginning*; QuillPress's equivalent is **Preview** (`view.previewMode`), which hides the guides and frame edges and shows the page as it prints.

| Choice | QuillPress command |
|---|---|
| AutoSave | `file.autosave` |
| New | `file.new` |
| Open | `file.open` |
| Save | `file.save` |
| Email | `file.email` |
| Quick Print | `file.quickPrint` |
| Print Preview and Print | `file.print` |
| Spelling | `review.spelling` |
| Undo | `edit.undo` |
| Redo (Repeat when nothing to redo) | `edit.redo` |
| Preview (the publishing equivalent of "start the show") | `view.previewMode` |
| Open Recent File | `file.openRecent` |
| Touch/Mouse Mode | `view.touchMode` |
| More Commands… | `file.customizeQat` |
| Show Above / Below the Ribbon / At the Bottom | `view.qatPosition` |
| Collapse the Ribbon | `view.collapseRibbon` |
| Hide Quick Access Toolbar | `view.qatHide` (restore: `view.qatShow`) |
| Show / Hide command labels | `view.qatLabels` |

## QuillPress's drop-down

1. **Standard choices** (the union above): AutoSave, New, Open, Save, Email, Quick Print, Print Preview and Print, Spelling, Undo, Redo, Preview, Touch/Mouse Mode, Open Recent File.
2. **Publishing extras:** Insert Page (`page.insert`), Text Frame (`insert.textFrame`), Picture (`insert.picture`), Save As (`file.saveAs`), Share (`file.share`), Export to PDF (`file.export.pdf`), Draw Table (`insert.drawTable`), Find (`edit.find`), Format Painter (`edit.formatPainter`), Search Commands (`view.cmdSearch`).
3. **Add All Choices (Save, Print first, then A–Z)** (`view.qatAddAll`): puts every choice from lists 1 and 2 on the bar: **Save** and **Print Preview and Print** first, then the remaining choices sorted alphabetically by label (case-insensitive), then anything else already on the bar in its existing order. Separators are kept. The same action is a button in the Customize Quick Access Bar dialog.
4. **More Commands…** (`file.customizeQat`).
5. **Show Above the Ribbon / Show Below the Ribbon / Show at the Bottom (near keyboard)** (`view.qatPosition`).
6. **Show / Hide Command Labels** (`view.qatLabels`).
7. **Hide Quick Access Bar** (`view.qatHide`; restore from View ▸ Show Quick Access Bar or by long-pressing any command).
8. **Collapse the Ribbon / Show the Ribbon** (`view.collapseRibbon`).

The result of **Add All Choices** with the default choices (checked by the catalog unit test):

| # | Command | id |
|---|---|---|
| 1 | Save | `file.save` |
| 2 | Print Preview and Print | `file.print` |
| 3 | AutoSave | `file.autosave` |
| 4 | Draw Table | `insert.drawTable` |
| 5 | Email | `file.email` |
| 6 | Export to PDF | `file.export.pdf` |
| 7 | Find | `edit.find` |
| 8 | Format Painter | `edit.formatPainter` |
| 9 | Insert Page | `page.insert` |
| 10 | New | `file.new` |
| 11 | Open | `file.open` |
| 12 | Open Recent File | `file.openRecent` |
| 13 | Picture | `insert.picture` |
| 14 | Preview | `view.previewMode` |
| 15 | Quick Print | `file.quickPrint` |
| 16 | Redo | `edit.redo` |
| 17 | Save As | `file.saveAs` |
| 18 | Search Commands | `view.cmdSearch` |
| 19 | Share | `file.share` |
| 20 | Spelling | `review.spelling` |
| 21 | Text Frame | `insert.textFrame` |
| 22 | Touch/Mouse Mode | `view.touchMode` |
| 23 | Undo | `edit.undo` |

The default bar (`DEFAULT_QAT`) is Save, Undo, Redo, Print, Insert Page and Search Commands. Right-click (or long-press) any command to add it to the bar, assign a shortcut, or open the customize dialog.
