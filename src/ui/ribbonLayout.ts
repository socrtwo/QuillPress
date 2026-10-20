/**
 * Default tab and group arrangement. Groups reference command ids only, so users can rebuild any of it
 * with Customize Tabs. Contextual tabs appear when their object (text frame, picture, shape, line,
 * table) is selected, or while a master page is being edited. Command ids follow docs/COMMANDS-PLAN.md.
 */
import type { App } from '../app';
import type { Item } from '../model/types';

export interface RibbonGroup { id: string; label: string; items: string[]; launcher?: string }
export interface RibbonTab { id: string; label: string; groups: RibbonGroup[]; contextual?: (app: App) => boolean; accent?: string; custom?: boolean }

const sel = (app: App): Item[] => (app.tab?.ui ? app.selected : []);
const only = (app: App, kinds: string[]) => { const s = sel(app); return s.length > 0 && s.every((e) => kinds.includes(e.kind)); };

export const DEFAULT_TABS: RibbonTab[] = [
  {
    id: 'home', label: 'Home', groups: [
      { id: 'clipboard', label: 'Clipboard', items: ['edit.paste', 'edit.cut', 'edit.copy', 'edit.duplicate', 'edit.formatPainter'], launcher: 'edit.clipboardPane' },
      { id: 'styles', label: 'Styles', items: ['fmt.paraStyle', 'fmt.charStyle', 'fmt.stylesPane'], launcher: 'fmt.stylesPane' },
      { id: 'font', label: 'Font', items: ['fmt.font', 'fmt.fontSize', 'fmt.growFont', 'fmt.shrinkFont', 'fmt.clearFormatting', 'fmt.bold', 'fmt.italic', 'fmt.underline', 'fmt.strike', 'fmt.superscript', 'fmt.subscript', 'fmt.changeCase', 'fmt.fontColor', 'fmt.highlight'], launcher: 'fmt.fontDialog' },
      { id: 'paragraph', label: 'Paragraph', items: ['fmt.bullets', 'fmt.numbering', 'fmt.outdent', 'fmt.indent', 'fmt.lineSpacing', 'fmt.alignLeft', 'fmt.alignCenter', 'fmt.alignRight', 'fmt.justify', 'fmt.paraSpacing', 'fmt.dropCap'], launcher: 'fmt.paragraphDialog' },
      { id: 'objects', label: 'Objects', items: ['insert.textFrame', 'insert.picture', 'insert.shape', 'insert.line', 'insert.table', 'arrange.menu'] },
      { id: 'editing', label: 'Editing', items: ['edit.find', 'edit.replace', 'edit.selectMenu', 'view.layersPane'] },
    ],
  },
  {
    id: 'insert', label: 'Insert', groups: [
      { id: 'pages', label: 'Pages', items: ['page.insert', 'page.insertBefore', 'page.insertMany', 'insert.pageNumber', 'insert.pageCount', 'insert.sectionMarker'] },
      { id: 'text', label: 'Text', items: ['insert.textFrame', 'insert.placeholderText', 'insert.textFile', 'insert.caption', 'insert.pullQuote', 'insert.sidebar', 'insert.toc', 'insert.textOnPath', 'insert.inlinePicture', 'insert.inlineFrame'] },
      { id: 'pictures', label: 'Pictures', items: ['insert.picture', 'insert.pictureFrame', 'insert.pictureFromUrl', 'insert.screenshot'] },
      { id: 'illustrations', label: 'Illustrations', items: ['insert.shape', 'insert.line', 'insert.rectangle', 'insert.ellipse', 'insert.polygon', 'insert.star', 'insert.arrow'] },
      { id: 'tables', label: 'Tables', items: ['insert.table', 'insert.drawTable', 'insert.tableFromText'] },
      { id: 'fields', label: 'Fields', items: ['insert.dateTime', 'insert.variable', 'insert.nextPage', 'insert.prevPage', 'insert.titleField'] },
      { id: 'symbols', label: 'Symbols', items: ['insert.symbol', 'insert.emoji', 'insert.specialChar', 'insert.equation', 'insert.codeBlock'] },
      { id: 'links', label: 'Links', items: ['insert.link', 'insert.removeLink', 'insert.bookmark', 'insert.comment', 'insert.indexMarker'] },
    ],
  },
  {
    id: 'pageDesign', label: 'Page Design', groups: [
      { id: 'setup', label: 'Page Setup', items: ['page.size', 'page.orientation', 'page.margins', 'page.columns', 'page.bleed', 'page.facing'], launcher: 'page.setupDialog' },
      { id: 'masters', label: 'Master Pages', items: ['page.editMaster', 'page.applyMaster', 'page.newMaster', 'page.duplicateMaster', 'page.masterOptions', 'page.closeMaster'] },
      { id: 'guides', label: 'Guides and Grids', items: ['page.addGuide', 'page.guidesDialog', 'page.clearGuides', 'page.lockGuides', 'page.baselineGrid', 'page.layoutGuides'] },
      { id: 'numbering', label: 'Numbering', items: ['page.numbering', 'page.sections', 'page.variables'] },
      { id: 'schemes', label: 'Schemes', items: ['page.colorScheme', 'page.fontScheme', 'page.swatchesPane', 'page.background', 'page.applyTemplate'] },
      { id: 'pages', label: 'Pages', items: ['page.insert', 'page.delete', 'page.duplicate', 'page.move', 'page.rename'] },
    ],
  },
  {
    id: 'text', label: 'Text', groups: [
      { id: 'frames', label: 'Text Frames', items: ['text.link', 'text.unlink', 'text.nextFrame', 'text.prevFrame', 'text.autoflow', 'text.threadsPane', 'text.splitStory'] },
      { id: 'frameOptions', label: 'Frame Options', items: ['text.columns', 'text.insets', 'text.verticalAlign', 'text.autosize', 'text.ignoreWrap', 'text.frameOptions'] },
      { id: 'typography', label: 'Typography', items: ['fmt.tracking', 'fmt.kerning', 'fmt.ligatures', 'fmt.smallCaps', 'fmt.allCaps', 'fmt.baselineShift', 'fmt.hyphenation', 'fmt.baselineGridAlign', 'fmt.tabs'] },
      { id: 'flow', label: 'Paragraph Flow', items: ['fmt.keepWithNext', 'fmt.keepLines', 'fmt.ruleAbove', 'fmt.ruleBelow', 'fmt.paragraphDialog'] },
      { id: 'notes', label: 'Notes', items: ['text.insertFootnote', 'text.editFootnote', 'text.deleteFootnote', 'text.prevFootnote', 'text.nextFootnote', 'text.goToReference', 'text.footnotesToEndnotes', 'text.endnotesToFootnotes', 'text.footnotesPane'], launcher: 'text.footnoteOptions' },
      { id: 'tools', label: 'Tools', items: ['text.fitCopy', 'text.oversetReport', 'text.storyEditor', 'text.wordCount', 'text.changeCase', 'text.insertLorem', 'tools.convertQuotes'] },
    ],
  },
  {
    id: 'arrange', label: 'Arrange', groups: [
      { id: 'order', label: 'Order', items: ['arrange.bringToFront', 'arrange.bringForward', 'arrange.sendBackward', 'arrange.sendToBack'] },
      { id: 'align', label: 'Align', items: ['arrange.align', 'arrange.alignLeft', 'arrange.alignCenter', 'arrange.alignRight', 'arrange.alignTop', 'arrange.alignMiddle', 'arrange.alignBottom', 'arrange.distributeH', 'arrange.distributeV', 'arrange.alignToPage'] },
      { id: 'group', label: 'Group', items: ['arrange.group', 'arrange.ungroup', 'arrange.lock', 'arrange.unlockAll', 'arrange.hide', 'arrange.showAll'] },
      { id: 'rotate', label: 'Rotate', items: ['arrange.rotate', 'arrange.rotateLeft', 'arrange.rotateRight', 'arrange.flipH', 'arrange.flipV'] },
      { id: 'wrap', label: 'Text Wrap', items: ['arrange.wrap', 'arrange.wrapNone', 'arrange.wrapSquare', 'arrange.wrapTight', 'arrange.wrapTopBottom', 'arrange.wrapOffset'] },
      { id: 'anchor', label: 'Anchor', items: ['arrange.anchorInline', 'arrange.anchorAbove', 'arrange.anchorCustom', 'arrange.releaseAnchor'], launcher: 'arrange.anchorOptions' },
      { id: 'size', label: 'Size and Position', items: ['arrange.sizeDialog', 'arrange.stepRepeat', 'arrange.layersPane', 'arrange.moveToLayer', 'arrange.makeSameSize'] },
    ],
  },
  {
    id: 'review', label: 'Review', groups: [
      { id: 'proofing', label: 'Proofing', items: ['review.spelling', 'review.dictionaries', 'review.statistics', 'review.readingLevel'] },
      { id: 'preflight', label: 'Preflight', items: ['review.preflight', 'review.preflightPane', 'review.fontsUsed', 'review.linksPane'] },
      { id: 'accessibility', label: 'Accessibility', items: ['review.checkAccessibility', 'review.altText', 'review.decorative'] },
      { id: 'comments', label: 'Comments', items: ['review.newComment', 'review.deleteComment', 'review.prevComment', 'review.nextComment', 'review.commentsPane'] },
      { id: 'language', label: 'Language', items: ['review.language', 'review.translate', 'review.lookUp'] },
      { id: 'protect', label: 'Protect', items: ['file.markFinal', 'file.encrypt'] },
    ],
  },
  {
    id: 'view', label: 'View', groups: [
      { id: 'views', label: 'Views', items: ['view.single', 'view.spread', 'view.previewMode'] },
      { id: 'show', label: 'Show', items: ['view.pagesPane', 'view.rulers', 'view.guides', 'view.grid', 'view.baselineGrid', 'view.frameEdges', 'view.textThreads'], launcher: 'view.gridSettings' },
      { id: 'zoom', label: 'Zoom', items: ['view.zoom', 'view.fitPage', 'view.fitWidth', 'view.actualSize', 'view.zoomIn', 'view.zoomOut'] },
      { id: 'color', label: 'Color', items: ['view.color', 'view.grayscale'] },
      { id: 'panes', label: 'Panes', items: ['view.layersPane', 'fmt.stylesPane', 'page.swatchesPane', 'text.threadsPane', 'review.commentsPane', 'view.navigator'] },
      { id: 'window', label: 'Window', items: ['view.newWindow', 'view.switchWindow', 'view.fullScreen'] },
      { id: 'macros', label: 'Macros', items: ['dev.macros'] },
    ],
  },
  {
    id: 'tools', label: 'Tools', groups: [
      { id: 'fonts', label: 'Fonts', items: ['tools.findFont', 'edit.replaceFonts', 'review.fontsUsed'] },
      { id: 'media', label: 'Pictures', items: ['tools.relink', 'tools.lowResReport', 'tools.compressPictures', 'tools.extractMedia'] },
      { id: 'cleanup', label: 'Clean Up', items: ['tools.unusedStyles', 'tools.unusedSwatches', 'tools.emptyFrames', 'tools.offPage', 'tools.resetMasterItems'] },
      { id: 'text', label: 'Text', items: ['tools.convertQuotes', 'tools.ocrCleanup', 'tools.textToFrames', 'tools.fillWithPlaceholder'] },
      { id: 'package', label: 'Package', items: ['tools.packageChecklist', 'file.package', 'tools.printerMarks'] },
    ],
  },
  {
    id: 'ai', label: 'AI', groups: [
      { id: 'setup', label: 'Setup', items: ['ai.setup', 'ai.active', 'ai.providers', 'ai.privacy', 'ai.stop'] },
      { id: 'create', label: 'Create', items: ['ai.draftPublication', 'ai.draftStory', 'ai.headlines', 'ai.pullQuotes', 'ai.captions'] },
      { id: 'write', label: 'Write', items: ['ai.rewrite', 'ai.shorten', 'ai.expand', 'ai.tone', 'ai.proofread', 'ai.translate', 'ai.fitCopy'] },
      { id: 'design', label: 'Design', items: ['ai.layoutSuggestions', 'ai.altText', 'ai.styleNames', 'ai.summarize'] },
      { id: 'more', label: 'More', items: ['ai.assistant', 'ai.prompts', 'ai.settings'] },
      { id: 'several', label: 'Several AIs', items: ['ai.ensembleMode', 'ai.ensembleMembers', 'ai.showDeliberation'] },
    ],
  },
  {
    id: 'developer', label: 'Developer', groups: [
      { id: 'code', label: 'Code', items: ['dev.macros', 'dev.recordMacro', 'dev.macroEditor', 'dev.macroSecurity'] },
      { id: 'data', label: 'Data', items: ['dev.tags', 'dev.exportJson', 'dev.importJson', 'dev.inspect'] },
    ],
  },
  {
    id: 'help', label: 'Help', groups: [
      { id: 'help', label: 'Help', items: ['help.help', 'help.shortcuts', 'help.commandReference', 'help.tour', 'help.whatsNew', 'help.feedback', 'help.notices', 'help.about'] },
    ],
  },
  // Master editing
  {
    id: 'masterPage', label: 'Master Page', contextual: (app) => !!app.tab?.masterTarget, accent: '#3E2672', groups: [
      { id: 'edit', label: 'Edit Master', items: ['page.newMaster', 'page.duplicateMaster', 'page.renameMaster', 'page.deleteMaster', 'page.masterOptions'] },
      { id: 'items', label: 'Master Items', items: ['insert.pageNumber', 'insert.textFrame', 'insert.picture', 'page.margins', 'page.columns'] },
      { id: 'apply', label: 'Apply', items: ['page.applyMaster', 'page.applyMasterAll'] },
      { id: 'close', label: 'Close', items: ['page.closeMaster'] },
    ],
  },
  // Contextual tabs
  {
    id: 'textFrame', label: 'Text Frame', contextual: (app) => only(app, ['text']) && !app.tab?.masterTarget, accent: '#5B3C9E', groups: [
      { id: 'frame', label: 'Frame', items: ['text.columns', 'text.insets', 'text.verticalAlign', 'text.autosize', 'text.frameOptions', 'shape.change'] },
      { id: 'flow', label: 'Flow', items: ['text.link', 'text.unlink', 'text.nextFrame', 'text.prevFrame', 'text.fitCopy'] },
      { id: 'notes', label: 'Notes', items: ['text.insertFootnote', 'text.footnotesPane'] },
      { id: 'style', label: 'Frame Style', items: ['shape.objectStyle', 'shape.fill', 'shape.outline', 'shape.effects', 'shape.transparency'] },
      { id: 'wrap', label: 'Text Wrap', items: ['arrange.wrap', 'arrange.anchorInline'] },
      { id: 'arrange', label: 'Arrange', items: ['arrange.bringForward', 'arrange.sendBackward', 'arrange.align', 'arrange.group', 'arrange.rotate'] },
      { id: 'size', label: 'Size', items: ['shape.height', 'shape.width', 'arrange.sizeDialog'] },
    ],
  },
  {
    id: 'pictureFormat', label: 'Picture', contextual: (app) => only(app, ['picture']), accent: '#1E7A46', groups: [
      { id: 'adjust', label: 'Adjust', items: ['picture.brightness', 'picture.contrast', 'picture.saturation', 'picture.grayscale', 'picture.reset'] },
      { id: 'fitting', label: 'Fitting', items: ['picture.fitting', 'picture.fillFrame', 'picture.fitProportionally', 'picture.fitFrameToPicture', 'picture.crop', 'picture.centerInFrame'] },
      { id: 'picture', label: 'Picture', items: ['picture.place', 'picture.change', 'picture.saveAs', 'picture.info', 'picture.compress'] },
      { id: 'style', label: 'Frame Style', items: ['shape.change', 'shape.outline', 'shape.effects', 'shape.transparency'] },
      { id: 'accessibility', label: 'Accessibility', items: ['review.altText', 'review.decorative'] },
      { id: 'wrap', label: 'Text Wrap', items: ['arrange.wrap', 'arrange.wrapOffset', 'arrange.anchorInline'] },
      { id: 'arrange', label: 'Arrange', items: ['arrange.bringForward', 'arrange.sendBackward', 'arrange.align', 'arrange.rotate'] },
      { id: 'size', label: 'Size', items: ['shape.height', 'shape.width', 'arrange.sizeDialog'] },
    ],
  },
  {
    id: 'shapeFormat', label: 'Shape', contextual: (app) => only(app, ['shape', 'group']), accent: '#C2502A', groups: [
      { id: 'insert', label: 'Insert Shapes', items: ['insert.shape', 'shape.change', 'shape.editPoints'] },
      { id: 'styles', label: 'Shape Styles', items: ['shape.objectStyle', 'shape.fill', 'shape.outline', 'shape.effects', 'shape.transparency'] },
      { id: 'text', label: 'Text', items: ['shape.convertToText', 'path.fromShape', 'review.altText', 'review.decorative'] },
      { id: 'wrap', label: 'Text Wrap', items: ['arrange.wrap', 'arrange.wrapOffset'] },
      { id: 'arrange', label: 'Arrange', items: ['arrange.bringForward', 'arrange.sendBackward', 'arrange.align', 'arrange.group', 'arrange.rotate'] },
      { id: 'size', label: 'Size', items: ['shape.height', 'shape.width', 'arrange.sizeDialog'] },
    ],
  },
  {
    id: 'lineFormat', label: 'Line', contextual: (app) => only(app, ['line']), accent: '#C2502A', groups: [
      { id: 'line', label: 'Line', items: ['shape.outline', 'shape.lineWidth', 'shape.lineDash', 'shape.lineEnds', 'shape.objectStyle'] },
      { id: 'arrange', label: 'Arrange', items: ['arrange.bringForward', 'arrange.sendBackward', 'arrange.align', 'arrange.rotate'] },
    ],
  },
  {
    id: 'textPath', label: 'Text Path', contextual: (app) => only(app, ['pathText']), accent: '#C2502A', groups: [
      { id: 'text', label: 'Path Text', items: ['path.editText', 'path.align', 'path.offset', 'path.baseline', 'path.spacing', 'path.flip'] },
      { id: 'path', label: 'Path', items: ['path.showPath', 'shape.outline', 'path.release'] },
      { id: 'font', label: 'Font', items: ['fmt.font', 'fmt.fontSize', 'fmt.bold', 'fmt.italic', 'fmt.fontColor'] },
      { id: 'arrange', label: 'Arrange', items: ['arrange.bringForward', 'arrange.sendBackward', 'arrange.align', 'arrange.rotate', 'arrange.wrap'] },
      { id: 'size', label: 'Size', items: ['shape.height', 'shape.width', 'arrange.sizeDialog'] },
    ],
  },
  {
    id: 'tableDesign', label: 'Table Design', contextual: (app) => only(app, ['table']), accent: '#2F6F8F', groups: [
      { id: 'options', label: 'Table Style Options', items: ['table.headerRow', 'table.bandedRows', 'table.firstColumn'] },
      { id: 'styles', label: 'Table Styles', items: ['table.style', 'table.shading', 'table.borders', 'table.innerBorders', 'table.clearStyle'] },
    ],
  },
  {
    id: 'tableLayout', label: 'Table Layout', contextual: (app) => only(app, ['table']), accent: '#2F6F8F', groups: [
      { id: 'rows', label: 'Rows & Columns', items: ['table.deleteMenu', 'table.insertAbove', 'table.insertBelow', 'table.insertLeft', 'table.insertRight'] },
      { id: 'merge', label: 'Merge', items: ['table.merge', 'table.split'] },
      { id: 'size', label: 'Cell Size', items: ['table.distributeRows', 'table.distributeColumns', 'table.rowHeight', 'table.columnWidth'] },
      { id: 'data', label: 'Data', items: ['table.editCells', 'table.sort', 'table.toText', 'table.cellInsets'] },
      { id: 'align', label: 'Alignment', items: ['fmt.alignLeft', 'fmt.alignCenter', 'fmt.alignRight', 'table.cellAlign'] },
    ],
  },
];

export const BACKSTAGE_ITEMS = ['file.new', 'file.open', 'file.save', 'file.saveAs', 'file.print', 'file.share', 'file.export.pdf', 'file.properties', 'file.versions', 'file.close', 'file.options'];

export function tabsFor(app: App): RibbonTab[] {
  const p = app.prefs;
  const order = p.tabOrder.length ? p.tabOrder : [];
  const builtIn = DEFAULT_TABS.filter((t) => !p.hiddenTabs.includes(t.id));
  const custom: RibbonTab[] = p.customTabs.filter((t) => !t.hidden).map((t) => ({ id: t.id, label: t.label, groups: t.groups, custom: true }));
  const all = [...builtIn, ...custom];
  if (!order.length) return all;
  return [...all].sort((a, b) => {
    const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
}

export function idsInTabs(): Set<string> {
  const s = new Set<string>();
  for (const t of DEFAULT_TABS) for (const g of t.groups) for (const id of g.items) s.add(id);
  return s;
}
