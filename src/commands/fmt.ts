/** Text formatting: styles, font, character and paragraph formatting, typography, style sheets. */
import { def, type MenuEntry } from './registry';
import type { App } from '../app';
import type { Bullet, CharStyle, NumScheme, ParaStyle, Paragraph, ParaProps, RunProps, Tab, TextFrame } from '../model/types';
import { clone } from '../model/pub';
import { resolvePara, resolveRun, paraChain, DEFAULT_BODY_FONT } from '../model/styles';
import { applyRun, applyPara, currentRun, currentPara, textTargets, forEachText, selection, edit } from '../edit/ops';
import { activeTextEditor } from '../edit/textEdit';
import { openDialog, toast, colorMenu, promptDialog, confirmDialog } from '../ui/dialog';
import { FONT_LIST } from '../fonts';
import { pickFile } from '../ui/dom';

const SIZES = [6, 7, 8, 9, 10, 10.5, 11, 12, 13, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 54, 60, 72, 96];

/** Resolved run formatting at the caret (style defaults applied). */
export function effectiveRun(app: App): RunProps {
  const p = currentPara(app);
  const base = resolvePara(app.pub.data, p as Paragraph).run;
  return resolveRun(app.pub.data, base, currentRun(app));
}

export function effectivePara(app: App): ParaProps {
  return resolvePara(app.pub.data, currentPara(app) as Paragraph).props;
}

const toggleRun = (key: keyof RunProps, label: string) => (app: App) => { const cur = !!effectiveRun(app)[key]; applyRun(app, label, { [key]: !cur } as any); };

function stepSize(app: App, dir: 1 | -1): void {
  applyRun(app, dir > 0 ? 'Grow Font' : 'Shrink Font', (r) => {
    const base = resolvePara(app.pub.data, currentPara(app) as Paragraph).run;
    const cur = resolveRun(app.pub.data, base, r).size || 11;
    const i = SIZES.findIndex((s) => (dir > 0 ? s > cur : s >= cur));
    const next = dir > 0 ? (i < 0 ? cur + 6 : SIZES[i]) : (i <= 0 ? Math.max(4, cur - 1) : SIZES[i - 1]);
    return { size: next };
  });
}

/** Paragraph style gallery entries. */
function paraStyleEntries(app: App): MenuEntry[] {
  const cur = currentPara(app).style || 'Body';
  return app.pub.data.styles.para.map((s) => {
    const r = resolvePara(app.pub.data, { style: s.name, runs: [] }).run;
    return { id: 'fmt.paraStyle', arg: s.name, label: s.name, checked: s.name === cur, preview: `font-family:"${r.font || DEFAULT_BODY_FONT}";font-size:${Math.min(18, Math.max(10, (r.size || 11) * 0.9))}px;${r.b ? 'font-weight:bold;' : ''}${r.i ? 'font-style:italic;' : ''}` };
  });
}

function charStyleEntries(app: App): MenuEntry[] {
  const cur = currentRun(app).cstyle || '';
  return [{ id: 'fmt.charStyle', arg: '', label: '[None]', checked: !cur }, ...app.pub.data.styles.char.map((s) => ({ id: 'fmt.charStyle', arg: s.name, label: s.name, checked: s.name === cur, preview: `${s.b ? 'font-weight:bold;' : ''}${s.i ? 'font-style:italic;' : ''}${s.font ? `font-family:"${s.font}";` : ''}${s.color && /^#/.test(s.color) ? `color:${s.color};` : ''}` }))];
}

async function colorArg(app: App, id: string, arg: any, opts: { none?: string; highlight?: boolean } = {}): Promise<string | null | undefined> {
  if (typeof arg === 'string' && arg !== 'menu') return arg;
  if (arg === 'menu' || arg == null) {
    const c = await colorMenu(app.ui.anchorFor(id), { title: opts.highlight ? 'Highlight' : 'Font color', none: opts.none, highlight: opts.highlight });
    return c === undefined ? undefined : c;
  }
  return undefined;
}

// ------------------------------------------------------------------------------------------
// Style sheet dialogs

const BULLET_CHARS = ['•', '◦', '▪', '–', '✓', '►', '★', '◆', '→', '○'];
const NUM_SCHEMES: { value: NumScheme; label: string }[] = [
  { value: 'arabicPeriod', label: '1. 2. 3.' }, { value: 'arabicParenR', label: '1) 2) 3)' }, { value: 'arabicPlain', label: '1 2 3' },
  { value: 'alphaUcPeriod', label: 'A. B. C.' }, { value: 'alphaLcPeriod', label: 'a. b. c.' }, { value: 'alphaLcParenR', label: 'a) b) c)' },
  { value: 'romanUcPeriod', label: 'I. II. III.' }, { value: 'romanLcPeriod', label: 'i. ii. iii.' },
];

function runFields(r: RunProps, prefix = ''): any[] {
  return [
    { key: prefix + 'font', label: 'Font', type: 'combo', options: FONT_LIST, value: r.font || '', half: true },
    { key: prefix + 'size', label: 'Size (pt)', type: 'number', min: 1, max: 999, step: 0.5, value: r.size ?? '', half: true },
    { key: prefix + 'b', label: 'Bold', type: 'checkbox', value: !!r.b, half: true },
    { key: prefix + 'i', label: 'Italic', type: 'checkbox', value: !!r.i, half: true },
    { key: prefix + 'u', label: 'Underline', type: 'checkbox', value: !!r.u, half: true },
    { key: prefix + 'strike', label: 'Strikethrough', type: 'checkbox', value: !!r.strike, half: true },
    { key: prefix + 'caps', label: 'Capitals', type: 'select', options: [{ value: 'none', label: 'Normal' }, { value: 'small', label: 'Small caps' }, { value: 'all', label: 'All caps' }], value: r.caps || 'none', half: true },
    { key: prefix + 'color', label: 'Color', type: 'color', value: r.color && /^#/.test(r.color) ? r.color : '#000000', half: true },
    { key: prefix + 'spc', label: 'Tracking (pt)', type: 'number', min: -20, max: 100, step: 0.1, value: r.spc ?? 0, half: true },
    { key: prefix + 'baseline', label: 'Superscript/subscript (% of size)', type: 'number', min: -100, max: 100, value: r.baseline ?? 0, half: true },
    { key: prefix + 'shift', label: 'Baseline shift (pt)', type: 'number', min: -1000, max: 1000, step: 0.1, value: r.shift ?? 0, half: true },
    { key: prefix + 'hscale', label: 'Horizontal scale (%)', type: 'number', min: 1, max: 1000, step: 1, value: r.hscale ?? 100, half: true },
    { key: prefix + 'outline', label: 'Outline', type: 'checkbox', value: !!r.outline, half: true },
    { key: prefix + 'tshadow', label: 'Shadow', type: 'checkbox', value: !!r.tshadow, half: true },
    { key: prefix + 'kern', label: 'Kerning', type: 'checkbox', value: r.kern !== false, half: true },
    { key: prefix + 'liga', label: 'Ligatures', type: 'checkbox', value: r.liga !== false, half: true },
  ];
}

function runFromFields(v: Record<string, any>, prefix = '', base: RunProps = {}): RunProps {
  const g = (k: string) => v[prefix + k];
  const out: RunProps = { ...base };
  out.font = g('font') || undefined;
  out.size = g('size') === '' || g('size') == null ? undefined : +g('size');
  out.b = !!g('b') || undefined; out.i = !!g('i') || undefined; out.u = !!g('u') || undefined; out.strike = !!g('strike') || undefined;
  out.caps = g('caps') === 'none' ? undefined : g('caps');
  out.color = g('color') && g('color') !== '#000000' ? g('color') : base.color && !/^#/.test(base.color) ? base.color : g('color') === '#000000' && base.color ? '#000000' : undefined;
  out.spc = +g('spc') || undefined;
  out.baseline = +g('baseline') || undefined;
  out.shift = +g('shift') || undefined;
  out.hscale = +g('hscale') > 0 && +g('hscale') !== 100 ? +g('hscale') : undefined;
  out.outline = !!g('outline') || undefined;
  out.tshadow = !!g('tshadow') || undefined;
  out.kern = g('kern') ? undefined : false;
  out.liga = g('liga') ? undefined : false;
  for (const k of Object.keys(out)) if ((out as any)[k] === undefined) delete (out as any)[k];
  return out;
}

function paraFields(p: ParaProps): any[] {
  return [
    { key: 'align', label: 'Alignment', type: 'select', options: [{ value: 'l', label: 'Left' }, { value: 'ctr', label: 'Center' }, { value: 'r', label: 'Right' }, { value: 'just', label: 'Justify' }, { value: 'justAll', label: 'Justify all lines' }], value: p.align || 'l', half: true },
    { key: 'lineSpacing', label: 'Leading', type: 'number', min: 0, max: 999, step: 0.5, value: p.lineSpacing ?? '', half: true, placeholder: 'auto' },
    { key: 'lineSpacingPt', label: 'Leading in points (otherwise % of size)', type: 'checkbox', value: !!p.lineSpacingPt, half: true },
    { key: 'marL', label: 'Left indent (pt)', type: 'number', min: 0, max: 999, value: p.marL ?? 0, half: true },
    { key: 'marR', label: 'Right indent (pt)', type: 'number', min: 0, max: 999, value: p.marR ?? 0, half: true },
    { key: 'indent', label: 'First-line indent (pt, negative hangs)', type: 'number', min: -999, max: 999, value: p.indent ?? 0, half: true },
    { key: 'spaceBefore', label: 'Space before (pt)', type: 'number', min: 0, max: 999, value: p.spaceBefore ?? 0, half: true },
    { key: 'spaceAfter', label: 'Space after (pt)', type: 'number', min: 0, max: 999, value: p.spaceAfter ?? 0, half: true },
    { key: 'hyphenate', label: 'Hyphenate', type: 'checkbox', value: !!p.hyphenate, half: true },
    { key: 'gridAlign', label: 'Align to baseline grid', type: 'checkbox', value: !!p.gridAlign, half: true },
    { key: 'opticalMargin', label: 'Optical margin alignment (hanging punctuation)', type: 'checkbox', value: !!p.opticalMargin, half: true },
    { key: 'keepWithNext', label: 'Keep with next paragraph', type: 'checkbox', value: !!p.keepWithNext, half: true },
    { key: 'keepLines', label: 'Keep lines together', type: 'checkbox', value: !!p.keepLines, half: true },
    { key: 'dropLines', label: 'Drop cap lines (0 = none)', type: 'number', min: 0, max: 10, value: p.dropCap?.lines ?? 0, half: true },
    { key: 'dropChars', label: 'Drop cap characters', type: 'number', min: 1, max: 10, value: p.dropCap?.chars ?? 1, half: true },
    { key: 'bulletKind', label: 'List', type: 'select', options: [{ value: 'none', label: 'None' }, { value: 'char', label: 'Bullet' }, { value: 'num', label: 'Numbered' }], value: p.bullet?.kind || 'none', half: true },
    { key: 'bulletChar', label: 'Bullet character', type: 'combo', options: BULLET_CHARS, value: p.bullet?.char || '•', half: true, visibleIf: (v: any) => v.bulletKind === 'char' },
    { key: 'scheme', label: 'Numbering', type: 'select', options: NUM_SCHEMES, value: p.bullet?.scheme || 'arabicPeriod', half: true, visibleIf: (v: any) => v.bulletKind === 'num' },
    { key: 'startAt', label: 'Start at', type: 'number', min: 1, value: p.bullet?.startAt ?? 1, half: true, visibleIf: (v: any) => v.bulletKind === 'num' },
    { key: 'ruleAbove', label: 'Rule above (pt, 0 = none)', type: 'number', min: 0, max: 50, step: 0.25, value: p.ruleAbove?.width ?? 0, half: true },
    { key: 'ruleBelow', label: 'Rule below (pt, 0 = none)', type: 'number', min: 0, max: 50, step: 0.25, value: p.ruleBelow?.width ?? 0, half: true },
    { key: 'tabs', label: 'Tab stops (position[l|c|r|d] per line, e.g. "72 l", "200 r .")', type: 'textarea', rows: 2, value: (p.tabs || []).map((t) => `${t.pos} ${{ l: 'l', ctr: 'c', r: 'r', dec: 'd' }[t.align]}${t.leader ? ' ' + t.leader : ''}`).join('\n') },
  ];
}

export function parseTabs(text: string): Tab[] | undefined {
  const out: Tab[] = [];
  for (const l of String(text || '').split('\n')) {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*([lcrd])?\s*(\S)?/i.exec(l);
    if (!m) continue;
    out.push({ pos: +m[1], align: ({ l: 'l', c: 'ctr', r: 'r', d: 'dec' } as const)[(m[2] || 'l').toLowerCase() as 'l' | 'c' | 'r' | 'd'], leader: m[3] || undefined });
  }
  return out.length ? out.sort((a, b) => a.pos - b.pos) : undefined;
}

function paraFromFields(v: Record<string, any>, base: ParaProps = {}): ParaProps {
  const out: ParaProps = { ...base };
  out.align = v.align === 'l' ? undefined : v.align;
  out.lineSpacing = v.lineSpacing === '' || v.lineSpacing == null ? undefined : +v.lineSpacing;
  out.lineSpacingPt = v.lineSpacingPt || undefined;
  out.marL = +v.marL || undefined; out.marR = +v.marR || undefined; out.indent = +v.indent || undefined;
  out.spaceBefore = +v.spaceBefore || undefined; out.spaceAfter = +v.spaceAfter || undefined;
  out.hyphenate = v.hyphenate || undefined; out.gridAlign = v.gridAlign || undefined; out.opticalMargin = v.opticalMargin || undefined; out.keepWithNext = v.keepWithNext || undefined; out.keepLines = v.keepLines || undefined;
  out.dropCap = +v.dropLines > 1 ? { lines: +v.dropLines, chars: Math.max(1, +v.dropChars || 1) } : undefined;
  out.bullet = v.bulletKind === 'char' ? { kind: 'char', char: v.bulletChar || '•' } : v.bulletKind === 'num' ? { kind: 'num', scheme: v.scheme, startAt: +v.startAt > 1 ? +v.startAt : undefined } : undefined;
  out.ruleAbove = +v.ruleAbove > 0 ? { width: +v.ruleAbove, color: base.ruleAbove?.color || '#000000' } : undefined;
  out.ruleBelow = +v.ruleBelow > 0 ? { width: +v.ruleBelow, color: base.ruleBelow?.color || '#000000' } : undefined;
  out.tabs = parseTabs(v.tabs);
  for (const k of Object.keys(out)) if ((out as any)[k] === undefined) delete (out as any)[k];
  return out;
}

async function paraStyleDialog(app: App, st?: ParaStyle): Promise<ParaStyle | null> {
  const pub = app.pub;
  const names = pub.data.styles.para.map((s) => s.name).filter((n) => n !== st?.name);
  const r = await openDialog({ title: st ? `Paragraph Style: ${st.name}` : 'New Paragraph Style', wide: true, fields: [
    { key: 'name', label: 'Name', type: 'text', value: st?.name || `Style ${pub.data.styles.para.length + 1}`, half: true },
    { key: 'basedOn', label: 'Based on', type: 'select', options: [{ value: '', label: '[No style]' }, ...names], value: st?.basedOn || '', half: true },
    { key: 'next', label: 'Next style', type: 'select', options: [{ value: '', label: '[Same style]' }, ...pub.data.styles.para.map((s) => s.name)], value: st?.next || '', half: true },
    { key: 'h1', type: 'heading', label: 'Character' }, ...runFields(st?.run || {}, 'r_'),
    { key: 'h2', type: 'heading', label: 'Paragraph' }, ...paraFields(st || {}),
  ], validate: (v) => (!v.name?.trim() ? 'Give the style a name.' : names.includes(v.name.trim()) ? 'A style with that name exists.' : v.basedOn === v.name ? 'A style cannot be based on itself.' : null) });
  if (!r) return null;
  const out: ParaStyle = { ...paraFromFields(r, st || {}), name: r.name.trim(), basedOn: r.basedOn || undefined, next: r.next || undefined, run: runFromFields(r, 'r_', st?.run || {}) };
  if (!Object.keys(out.run!).length) delete out.run;
  return out;
}

async function charStyleDialog(app: App, st?: CharStyle): Promise<CharStyle | null> {
  const pub = app.pub;
  const names = pub.data.styles.char.map((s) => s.name).filter((n) => n !== st?.name);
  const r = await openDialog({ title: st ? `Character Style: ${st.name}` : 'New Character Style', wide: true, fields: [
    { key: 'name', label: 'Name', type: 'text', value: st?.name || `Character Style ${pub.data.styles.char.length + 1}`, half: true },
    { key: 'basedOn', label: 'Based on', type: 'select', options: [{ value: '', label: '[None]' }, ...names], value: st?.basedOn || '', half: true },
    ...runFields(st || {}),
  ], validate: (v) => (!v.name?.trim() ? 'Give the style a name.' : names.includes(v.name.trim()) ? 'A style with that name exists.' : null) });
  if (!r) return null;
  return { ...runFromFields(r, '', st || {}), name: r.name.trim(), basedOn: r.basedOn || undefined };
}

/** Renames a paragraph style everywhere it is referenced. */
function renameParaStyle(app: App, from: string, to: string): void {
  const pub = app.pub;
  for (const s of pub.data.styles.para) { if (s.basedOn === from) s.basedOn = to; if (s.next === from) s.next = to; }
  forEachText(app, (paras) => { for (const p of paras) if (p.style === from) p.style = to; });
}

function renameCharStyle(app: App, from: string, to: string | undefined): void {
  const pub = app.pub;
  for (const s of pub.data.styles.char) if (s.basedOn === from) s.basedOn = to;
  forEachText(app, (paras) => { for (const p of paras) { for (const r of p.runs) if (r.cstyle === from) { if (to) r.cstyle = to; else delete r.cstyle; } if (p.end?.cstyle === from) { if (to) p.end.cstyle = to; else delete p.end.cstyle; } } });
}

// ------------------------------------------------------------------------------------------

def([
  {
    id: 'fmt.paraStyle', label: 'Paragraph Styles', icon: 'format_paragraph', tab: 'Home', group: 'Styles', kind: 'gallery', popular: true, edits: true,
    tip: 'Apply a paragraph style (Body, Heading 1, Pull Quote…)',
    menu: (app) => [...paraStyleEntries(app), { separator: true }, { id: 'fmt.newParaStyle', label: 'New Paragraph Style…', icon: 'add' }, { id: 'fmt.stylesPane', label: 'Styles Pane', icon: 'style' }],
    run: async (app, name?: string) => {
      if (!name) { const r = await openDialog({ title: 'Paragraph Style', fields: [{ key: 's', label: 'Style', type: 'list', rows: 10, options: app.pub.data.styles.para.map((s) => s.name), value: currentPara(app).style || 'Body' }] }); if (!r) return; name = r.s; }
      if (!app.pub.paraStyle(name!)) { toast(`No paragraph style named "${name}".`); return; }
      applyPara(app, 'Paragraph Style', () => ({ style: name }));
    },
  },
  {
    id: 'fmt.charStyle', label: 'Character Styles', icon: 'text_format', tab: 'Home', group: 'Styles', kind: 'menu', edits: true,
    menu: (app) => [...charStyleEntries(app), { separator: true }, { id: 'fmt.newCharStyle', label: 'New Character Style…', icon: 'add' }],
    run: async (app, name?: string) => {
      if (name === undefined) { const r = await openDialog({ title: 'Character Style', fields: [{ key: 's', label: 'Style', type: 'list', rows: 8, options: [{ value: '', label: '[None]' }, ...app.pub.data.styles.char.map((s) => s.name)], value: currentRun(app).cstyle || '' }] }); if (!r) return; name = r.s; }
      if (name && !app.pub.charStyle(name)) { toast(`No character style named "${name}".`); return; }
      applyRun(app, 'Character Style', { cstyle: name || undefined });
    },
  },
  { id: 'fmt.stylesPane', label: 'Styles', icon: 'style', tab: 'Home', group: 'Styles', keys: ['F11'], noRecord: true, run: (app) => app.ui.togglePane('styles') },
  {
    id: 'fmt.font', label: 'Font', icon: 'font_download', tab: 'Home', group: 'Font', kind: 'font', popular: true, edits: true,
    value: (app) => effectiveRun(app).font || '',
    run: (app, font?: string) => { if (!font) return; applyRun(app, 'Font', { font }); },
  },
  {
    id: 'fmt.fontSize', label: 'Font Size', icon: 'format_size', tab: 'Home', group: 'Font', kind: 'size', popular: true, edits: true,
    value: (app) => { const s = effectiveRun(app).size; return s != null ? +s.toFixed(1) : ''; },
    menu: () => SIZES.map((s) => ({ id: 'fmt.fontSize', arg: s, label: String(s) })),
    run: (app, size?: number | string) => { const n = parseFloat(String(size)); if (!isNaN(n) && n > 0) applyRun(app, 'Font Size', { size: Math.min(999, n) }); },
  },
  { id: 'fmt.growFont', label: 'Grow Font', icon: 'text_increase', tab: 'Home', group: 'Font', keys: ['Mod-Shift-.'], edits: true, run: (app) => stepSize(app, 1) },
  { id: 'fmt.shrinkFont', label: 'Shrink Font', icon: 'text_decrease', tab: 'Home', group: 'Font', keys: ['Mod-Shift-,'], edits: true, run: (app) => stepSize(app, -1) },
  {
    id: 'fmt.clearFormatting', label: 'Clear All Formatting', icon: 'format_clear', tab: 'Home', group: 'Font', keys: ['Mod-Space'], edits: true,
    tip: 'Remove local formatting; the paragraph and character styles stay',
    run: (app) => { applyRun(app, 'Clear Formatting', (r) => { const keep: RunProps = {}; if (r.cstyle) keep.cstyle = r.cstyle; if (r.link) keep.link = r.link; for (const k of Object.keys(r)) if (!['text', 'field', 'varName', 'br', 'cstyle', 'link'].includes(k)) (r as any)[k] = undefined; return keep; }); },
  },
  { id: 'fmt.bold', label: 'Bold', icon: 'format_bold', tab: 'Home', group: 'Font', keys: ['Mod-b'], kind: 'toggle', popular: true, edits: true, isActive: (app) => !!effectiveRun(app).b, run: toggleRun('b', 'Bold') },
  { id: 'fmt.italic', label: 'Italic', icon: 'format_italic', tab: 'Home', group: 'Font', keys: ['Mod-i'], kind: 'toggle', popular: true, edits: true, isActive: (app) => !!effectiveRun(app).i, run: toggleRun('i', 'Italic') },
  { id: 'fmt.underline', label: 'Underline', icon: 'format_underlined', tab: 'Home', group: 'Font', keys: ['Mod-u'], kind: 'toggle', popular: true, edits: true, isActive: (app) => !!effectiveRun(app).u, run: toggleRun('u', 'Underline') },
  { id: 'fmt.strike', label: 'Strikethrough', icon: 'format_strikethrough', tab: 'Home', group: 'Font', kind: 'toggle', edits: true, isActive: (app) => !!effectiveRun(app).strike, run: toggleRun('strike', 'Strikethrough') },
  { id: 'fmt.superscript', label: 'Superscript', icon: 'superscript', tab: 'Home', group: 'Font', keys: ['Mod-Shift-='], kind: 'toggle', edits: true, isActive: (app) => (effectiveRun(app).baseline || 0) > 0, run: (app) => { const on = (effectiveRun(app).baseline || 0) > 0; applyRun(app, 'Superscript', { baseline: on ? undefined : 33 }); } },
  { id: 'fmt.subscript', label: 'Subscript', icon: 'subscript', tab: 'Home', group: 'Font', keys: ['Mod-='], kind: 'toggle', edits: true, isActive: (app) => (effectiveRun(app).baseline || 0) < 0, run: (app) => { const on = (effectiveRun(app).baseline || 0) < 0; applyRun(app, 'Subscript', { baseline: on ? undefined : -33 }); } },
  {
    id: 'fmt.changeCase', label: 'Change Case', icon: 'match_case', tab: 'Home', group: 'Font', kind: 'menu', keys: ['Shift-F3'], edits: true,
    menu: () => [{ id: 'fmt.changeCase', arg: 'sentence', label: 'Sentence case.' }, { id: 'fmt.changeCase', arg: 'lower', label: 'lowercase' }, { id: 'fmt.changeCase', arg: 'upper', label: 'UPPERCASE' }, { id: 'fmt.changeCase', arg: 'title', label: 'Capitalize Each Word' }, { id: 'fmt.changeCase', arg: 'toggle', label: 'tOGGLE cASE' }],
    run: (app, how = 'toggle') => {
      const conv = (t: string) => how === 'lower' ? t.toLowerCase() : how === 'upper' ? t.toUpperCase() : how === 'title' ? t.replace(/\p{L}[\p{L}\p{M}'’]*/gu, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()) : how === 'sentence' ? t.toLowerCase().replace(/(^\s*\p{L}|[.!?]\s+\p{L})/gu, (m) => m.toUpperCase()) : [...t].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('');
      const ed = activeTextEditor();
      if (ed) { const sel = ed.selectedText(); if (sel) { ed.insertText(conv(sel)); return; } }
      const frames = textTargets(app);
      if (!frames.length) { toast('Select text or a text frame first.'); return; }
      app.pub.transact('Change Case', () => { for (const sid of new Set(frames.map((f) => f.story))) { const s = app.pub.story(sid); if (s) for (const p of s.paras) for (const r of p.runs) if (!r.field) r.text = conv(r.text); } });
    },
  },
  {
    id: 'fmt.fontColor', label: 'Font Color', icon: 'format_color_text', tab: 'Home', group: 'Font', kind: 'color', popular: true, edits: true,
    run: async (app, arg) => { const c = await colorArg(app, 'fmt.fontColor', arg, { none: 'Automatic' }); if (c === undefined) return; applyRun(app, 'Font Color', { color: c || undefined }); },
  },
  {
    id: 'fmt.highlight', label: 'Highlight', icon: 'format_ink_highlighter', tab: 'Home', group: 'Font', kind: 'color', edits: true,
    run: async (app, arg) => { const c = await colorArg(app, 'fmt.highlight', arg, { none: 'No Color', highlight: true }); if (c === undefined) return; applyRun(app, 'Highlight', { highlight: c || undefined }); },
  },
  {
    id: 'fmt.fontDialog', label: 'Font…', icon: 'text_fields', tab: 'Home', group: 'Font', keys: ['Mod-Shift-f'], edits: true,
    run: async (app) => {
      const cur = effectiveRun(app);
      const r = await openDialog({ title: 'Font', wide: true, fields: runFields(cur) });
      if (!r) return;
      applyRun(app, 'Font', runFromFields(r, '', currentRun(app)));
    },
  },
  {
    id: 'fmt.bullets', label: 'Bullets', icon: 'format_list_bulleted', tab: 'Home', group: 'Paragraph', kind: 'split', keys: ['Mod-Shift-8'], popular: true, edits: true,
    isActive: (app) => effectivePara(app).bullet?.kind === 'char',
    menu: () => [...BULLET_CHARS.map((c) => ({ id: 'fmt.bullets', arg: c, label: `${c}  Bullet` })), { separator: true }, { id: 'fmt.bullets', arg: 'none', label: 'None' }, { id: 'fmt.listDialog', label: 'Bullets and Numbering…' }],
    run: (app, ch?: string) => {
      if (ch === 'none') { applyPara(app, 'Bullets', { bullet: undefined }); return; }
      const on = effectivePara(app).bullet?.kind === 'char';
      const b: Bullet | undefined = ch ? { kind: 'char', char: ch } : on ? undefined : { kind: 'char', char: '•' };
      applyPara(app, 'Bullets', (p) => ({ bullet: b, marL: b ? Math.max(p.marL || 0, 18) : undefined, indent: b ? -18 : undefined }));
    },
  },
  {
    id: 'fmt.numbering', label: 'Numbering', icon: 'format_list_numbered', tab: 'Home', group: 'Paragraph', kind: 'split', keys: ['Mod-Shift-7'], edits: true,
    isActive: (app) => effectivePara(app).bullet?.kind === 'num',
    menu: () => [...NUM_SCHEMES.map((s) => ({ id: 'fmt.numbering', arg: s.value, label: s.label })), { separator: true }, { id: 'fmt.numbering', arg: 'none', label: 'None' }, { id: 'fmt.restartNumbering', label: 'Restart at 1' }, { id: 'fmt.listDialog', label: 'Bullets and Numbering…' }],
    run: (app, scheme?: string) => {
      if (scheme === 'none') { applyPara(app, 'Numbering', { bullet: undefined }); return; }
      const on = effectivePara(app).bullet?.kind === 'num';
      const b: Bullet | undefined = scheme ? { kind: 'num', scheme: scheme as NumScheme } : on ? undefined : { kind: 'num', scheme: 'arabicPeriod' };
      applyPara(app, 'Numbering', (p) => ({ bullet: b, marL: b ? Math.max(p.marL || 0, 22) : undefined, indent: b ? -22 : undefined }));
    },
  },
  { id: 'fmt.restartNumbering', label: 'Restart Numbering', icon: 'restart_alt', tab: 'Home', group: 'Paragraph', edits: true, run: (app) => applyPara(app, 'Restart Numbering', (p) => ({ bullet: { ...(p.bullet || { kind: 'num', scheme: 'arabicPeriod' }), kind: 'num', startAt: 1 } })) },
  {
    id: 'fmt.listDialog', label: 'Bullets and Numbering…', icon: 'list', tab: 'Home', group: 'Paragraph', edits: true,
    run: async (app) => {
      const b = effectivePara(app).bullet;
      const r = await openDialog({ title: 'Bullets and Numbering', fields: [
        { key: 'kind', label: 'List', type: 'radio', options: [{ value: 'none', label: 'None' }, { value: 'char', label: 'Bulleted' }, { value: 'num', label: 'Numbered' }], value: b?.kind || 'none' },
        { key: 'char', label: 'Bullet character', type: 'combo', options: BULLET_CHARS, value: b?.char || '•', visibleIf: (v) => v.kind === 'char' },
        { key: 'scheme', label: 'Numbering', type: 'select', options: NUM_SCHEMES, value: b?.scheme || 'arabicPeriod', visibleIf: (v) => v.kind === 'num' },
        { key: 'startAt', label: 'Start at', type: 'number', min: 1, value: b?.startAt ?? 1, visibleIf: (v) => v.kind === 'num' },
        { key: 'size', label: 'Bullet size (% of text)', type: 'number', min: 25, max: 400, value: b?.size ?? 100, half: true },
        { key: 'color', label: 'Bullet color', type: 'color', value: b?.color && /^#/.test(b.color) ? b.color : '#000000', half: true },
        { key: 'hang', label: 'Hanging indent (pt)', type: 'number', min: 0, max: 200, value: 18 },
      ] });
      if (!r) return;
      const nb: Bullet | undefined = r.kind === 'none' ? undefined : { kind: r.kind, char: r.kind === 'char' ? r.char : undefined, scheme: r.kind === 'num' ? r.scheme : undefined, startAt: r.kind === 'num' && +r.startAt > 1 ? +r.startAt : undefined, size: +r.size !== 100 ? +r.size : undefined, color: r.color !== '#000000' ? r.color : undefined };
      applyPara(app, 'Bullets and Numbering', () => ({ bullet: nb, marL: nb ? +r.hang : undefined, indent: nb ? -r.hang : undefined }));
    },
  },
  { id: 'fmt.outdent', label: 'Decrease Indent', icon: 'format_indent_decrease', tab: 'Home', group: 'Paragraph', keys: ['Mod-Shift-m'], edits: true, run: (app) => applyPara(app, 'Decrease Indent', (p) => ({ marL: Math.max(0, (p.marL || 0) - 18) || undefined })) },
  { id: 'fmt.indent', label: 'Increase Indent', icon: 'format_indent_increase', tab: 'Home', group: 'Paragraph', keys: ['Mod-m'], edits: true, run: (app) => applyPara(app, 'Increase Indent', (p) => ({ marL: (p.marL || 0) + 18 })) },
  {
    id: 'fmt.lineSpacing', label: 'Leading', icon: 'format_line_spacing', tab: 'Home', group: 'Paragraph', kind: 'menu', edits: true,
    tip: 'Line spacing: a percentage of the type size, or exact points',
    menu: (app) => { const cur = effectivePara(app); return [...[100, 110, 120, 150, 200].map((v) => ({ id: 'fmt.lineSpacing', arg: v, label: `${v}%`, checked: !cur.lineSpacingPt && (cur.lineSpacing ?? 120) === v })), { separator: true }, { id: 'fmt.lineSpacing', arg: 'exact', label: 'Exact Points…' }, { id: 'fmt.paraSpacing', label: 'Space Before and After…' }]; },
    run: async (app, v?: number | string) => {
      if (v === 'exact' || v == null) {
        const cur = effectivePara(app);
        const r = await openDialog({ title: 'Leading', fields: [{ key: 'pt', label: 'Leading in points', type: 'number', min: 1, max: 500, step: 0.5, value: cur.lineSpacingPt ? cur.lineSpacing : Math.round((effectiveRun(app).size || 11) * ((cur.lineSpacing || 120) / 100) * 2) / 2 }] });
        if (!r) return;
        applyPara(app, 'Leading', { lineSpacing: +r.pt, lineSpacingPt: true });
        return;
      }
      applyPara(app, 'Leading', { lineSpacing: +v, lineSpacingPt: undefined });
    },
  },
  { id: 'fmt.alignLeft', label: 'Align Left', icon: 'format_align_left', tab: 'Home', group: 'Paragraph', keys: ['Mod-l'], kind: 'toggle', popular: true, edits: true, isActive: (app) => (effectivePara(app).align || 'l') === 'l', run: (app) => applyPara(app, 'Align Left', { align: 'l' }) },
  { id: 'fmt.alignCenter', label: 'Center', icon: 'format_align_center', tab: 'Home', group: 'Paragraph', keys: ['Mod-e'], kind: 'toggle', popular: true, edits: true, isActive: (app) => effectivePara(app).align === 'ctr', run: (app) => applyPara(app, 'Center', { align: 'ctr' }) },
  { id: 'fmt.alignRight', label: 'Align Right', icon: 'format_align_right', tab: 'Home', group: 'Paragraph', keys: ['Mod-Shift-r'], kind: 'toggle', edits: true, isActive: (app) => effectivePara(app).align === 'r', run: (app) => applyPara(app, 'Align Right', { align: 'r' }) },
  { id: 'fmt.justify', label: 'Justify', icon: 'format_align_justify', tab: 'Home', group: 'Paragraph', keys: ['Mod-j'], kind: 'toggle', popular: true, edits: true, isActive: (app) => effectivePara(app).align === 'just', run: (app) => applyPara(app, 'Justify', { align: 'just' }) },
  { id: 'fmt.justifyAll', label: 'Justify All Lines', icon: 'format_align_justify', tab: 'Home', group: 'Paragraph', kind: 'toggle', edits: true, tip: 'Justify the last line of each paragraph too', isActive: (app) => effectivePara(app).align === 'justAll', run: (app) => applyPara(app, 'Justify All', { align: 'justAll' }) },
  {
    id: 'fmt.paraSpacing', label: 'Paragraph Spacing', icon: 'vertical_align_center', tab: 'Home', group: 'Paragraph', kind: 'menu', edits: true,
    menu: () => [{ id: 'fmt.paraSpacing', arg: 'none', label: 'No Space Between Paragraphs' }, { id: 'fmt.paraSpacing', arg: 'after', label: 'Add Space After (6 pt)' }, { id: 'fmt.paraSpacing', arg: 'before', label: 'Add Space Before (6 pt)' }, { separator: true }, { id: 'fmt.paraSpacing', arg: 'dialog', label: 'Space Before and After…' }],
    run: async (app, what?: string) => {
      if (what === 'none') { applyPara(app, 'Paragraph Spacing', { spaceBefore: undefined, spaceAfter: undefined }); return; }
      if (what === 'after') { applyPara(app, 'Paragraph Spacing', { spaceAfter: 6 }); return; }
      if (what === 'before') { applyPara(app, 'Paragraph Spacing', { spaceBefore: 6 }); return; }
      const cur = effectivePara(app);
      const r = await openDialog({ title: 'Paragraph Spacing', fields: [{ key: 'b', label: 'Space before (pt)', type: 'number', min: 0, max: 999, value: cur.spaceBefore ?? 0, half: true }, { key: 'a', label: 'Space after (pt)', type: 'number', min: 0, max: 999, value: cur.spaceAfter ?? 0, half: true }] });
      if (!r) return;
      applyPara(app, 'Paragraph Spacing', { spaceBefore: +r.b || undefined, spaceAfter: +r.a || undefined });
    },
  },
  {
    id: 'fmt.dropCap', label: 'Drop Cap', icon: 'format_h1', tab: 'Home', group: 'Paragraph', kind: 'split', edits: true, origin: 'Drop caps (Ventura Publisher, PageMaker)',
    isActive: (app) => !!effectivePara(app).dropCap,
    menu: () => [{ id: 'fmt.dropCap', arg: 2, label: '2 lines' }, { id: 'fmt.dropCap', arg: 3, label: '3 lines' }, { id: 'fmt.dropCap', arg: 4, label: '4 lines' }, { separator: true }, { id: 'fmt.dropCap', arg: 0, label: 'None' }, { id: 'fmt.dropCapDialog', label: 'Drop Cap Options…' }],
    run: (app, lines?: number) => { const on = !!effectivePara(app).dropCap; const n = lines === undefined ? (on ? 0 : 3) : +lines; applyPara(app, 'Drop Cap', (p) => ({ dropCap: n > 1 ? { lines: n, chars: p.dropCap?.chars || 1 } : undefined })); },
  },
  {
    id: 'fmt.dropCapDialog', label: 'Drop Cap Options…', icon: 'format_h1', tab: 'Home', group: 'Paragraph', edits: true,
    run: async (app) => { const d = effectivePara(app).dropCap; const r = await openDialog({ title: 'Drop Cap', fields: [{ key: 'l', label: 'Lines', type: 'number', min: 0, max: 10, value: d?.lines ?? 3, half: true }, { key: 'c', label: 'Characters', type: 'number', min: 1, max: 10, value: d?.chars ?? 1, half: true }] }); if (!r) return; applyPara(app, 'Drop Cap', { dropCap: +r.l > 1 ? { lines: +r.l, chars: Math.max(1, +r.c) } : undefined }); },
  },
  {
    id: 'fmt.paragraphDialog', label: 'Paragraph…', icon: 'format_paragraph', tab: 'Home', group: 'Paragraph', keys: ['Mod-Alt-m'], edits: true,
    run: async (app) => {
      const cur = effectivePara(app);
      const r = await openDialog({ title: 'Paragraph', wide: true, fields: paraFields(cur) });
      if (!r) return;
      const local = currentPara(app);
      const { runs: _r, end: _e, style, ...localProps } = local as any;
      applyPara(app, 'Paragraph', () => ({ ...Object.fromEntries(Object.keys(localProps).map((k) => [k, undefined])), ...paraFromFields(r, localProps), style }));
    },
  },
  // Typography
  {
    id: 'fmt.tracking', label: 'Tracking', icon: 'format_letter_spacing', tab: 'Text', group: 'Typography', kind: 'size', edits: true,
    tip: 'Letter spacing in points (negative tightens)',
    value: (app) => effectiveRun(app).spc ?? 0,
    menu: () => [-1, -0.5, -0.25, 0, 0.25, 0.5, 1, 2, 4].map((v) => ({ id: 'fmt.tracking', arg: v, label: v === 0 ? 'Normal' : `${v > 0 ? '+' : ''}${v} pt` })),
    run: (app, v?: number | string) => { const n = parseFloat(String(v)); if (!isNaN(n)) applyRun(app, 'Tracking', { spc: n || undefined }); },
  },
  { id: 'fmt.kerning', label: 'Kerning', icon: 'format_letter_spacing_standard', tab: 'Text', group: 'Typography', kind: 'toggle', edits: true, tip: 'Pair kerning from the font (on by default)', isActive: (app) => effectiveRun(app).kern !== false, run: (app) => { const on = effectiveRun(app).kern !== false; applyRun(app, 'Kerning', { kern: on ? false : undefined }); } },
  { id: 'fmt.ligatures', label: 'Ligatures', icon: 'join_inner', tab: 'Text', group: 'Typography', kind: 'toggle', edits: true, tip: 'Standard ligatures (fi, fl) from the font', isActive: (app) => effectiveRun(app).liga !== false, run: (app) => { const on = effectiveRun(app).liga !== false; applyRun(app, 'Ligatures', { liga: on ? false : undefined }); } },
  { id: 'fmt.smallCaps', label: 'Small Caps', icon: 'format_size', tab: 'Text', group: 'Typography', keys: ['Mod-Shift-k'], kind: 'toggle', edits: true, isActive: (app) => effectiveRun(app).caps === 'small', run: (app) => { const on = effectiveRun(app).caps === 'small'; applyRun(app, 'Small Caps', { caps: on ? undefined : 'small' }); } },
  { id: 'fmt.allCaps', label: 'All Caps', icon: 'text_fields', tab: 'Text', group: 'Typography', keys: ['Mod-Shift-a'], kind: 'toggle', edits: true, isActive: (app) => effectiveRun(app).caps === 'all', run: (app) => { const on = effectiveRun(app).caps === 'all'; applyRun(app, 'All Caps', { caps: on ? undefined : 'all' }); } },
  {
    id: 'fmt.baselineShift', label: 'Baseline Shift', icon: 'vertical_align_top', tab: 'Text', group: 'Typography', kind: 'size', edits: true,
    tip: 'Raise or lower the text relative to the baseline (% of the size)',
    value: (app) => effectiveRun(app).baseline ?? 0,
    menu: () => [-50, -33, -20, -10, 0, 10, 20, 33, 50].map((v) => ({ id: 'fmt.baselineShift', arg: v, label: v === 0 ? 'None' : `${v > 0 ? '+' : ''}${v}%` })),
    run: (app, v?: number | string) => { const n = parseFloat(String(v)); if (!isNaN(n)) applyRun(app, 'Baseline Shift', { baseline: n || undefined }); },
  },
  {
    id: 'fmt.baselineShiftPoints', label: 'Baseline Shift (pt)', icon: 'height', tab: 'Text', group: 'Typography', kind: 'size', edits: true, origin: 'Baseline shift (QuarkXPress, PageMaker)',
    tip: 'Raise (positive) or lower the text by points, at full size (superscript and subscript are separate)',
    value: (app) => effectiveRun(app).shift ?? 0,
    menu: () => [-6, -3, -2, -1, 0, 1, 2, 3, 6].map((v) => ({ id: 'fmt.baselineShiftPoints', arg: v, label: v === 0 ? 'None' : `${v > 0 ? '+' : ''}${v} pt` })),
    run: (app, v?: number | string) => { const x = parseFloat(String(v)); if (!isNaN(x)) applyRun(app, 'Baseline Shift', { shift: x || undefined }); },
  },
  {
    id: 'fmt.hscale', label: 'Horizontal Scale', icon: 'width', tab: 'Text', group: 'Typography', kind: 'size', edits: true, origin: 'Horizontal scale (QuarkXPress, PageMaker set width)',
    tip: 'Stretch or condense the glyphs horizontally (percent of their normal width)',
    value: (app) => effectiveRun(app).hscale ?? 100,
    menu: () => [50, 70, 80, 90, 100, 110, 120, 150, 200].map((v) => ({ id: 'fmt.hscale', arg: v, label: v === 100 ? 'Normal (100%)' : `${v}%` })),
    run: (app, v?: number | string) => { const x = parseFloat(String(v)); if (x > 0) applyRun(app, 'Horizontal Scale', { hscale: x === 100 ? undefined : Math.min(1000, x) }); },
  },
  { id: 'fmt.outline', label: 'Outline', icon: 'format_color_text', tab: 'Text', group: 'Typography', kind: 'toggle', edits: true, origin: 'Outline type style (Macintosh, QuarkXPress, PageMaker)', tip: 'Outline type: the letters drawn as outlines in the text color, filled with paper', isActive: (app) => !!effectiveRun(app).outline, run: (app) => { const on = !!effectiveRun(app).outline; applyRun(app, 'Outline', { outline: on ? undefined : true }); } },
  { id: 'fmt.textShadow', label: 'Shadow', icon: 'texture', tab: 'Text', group: 'Typography', kind: 'toggle', edits: true, origin: 'Shadow type style (Macintosh, QuarkXPress, PageMaker)', tip: 'Shadow type: a lighter copy of the letters behind them, down and to the right', isActive: (app) => !!effectiveRun(app).tshadow, run: (app) => { const on = !!effectiveRun(app).tshadow; applyRun(app, 'Shadow', { tshadow: on ? undefined : true }); } },
  { id: 'fmt.hyphenation', label: 'Hyphenate', icon: 'remove', tab: 'Text', group: 'Typography', kind: 'toggle', edits: true, origin: 'TeX hyphenation', tip: 'Break long words at syllable-like points so justified text has fewer gaps', isActive: (app) => !!effectivePara(app).hyphenate, run: (app) => { const on = !!effectivePara(app).hyphenate; applyPara(app, 'Hyphenate', { hyphenate: on ? undefined : true }); } },
  {
    id: 'fmt.opticalMargin', label: 'Optical Margin Alignment', icon: 'format_indent_decrease', tab: 'Text', group: 'Typography', kind: 'toggle', edits: true, origin: 'Hanging punctuation (Gutenberg; InDesign optical margin alignment)',
    tip: 'Hang punctuation and the open sides of letters outside the margins so the edges of the paragraph look straight (the editing island shows the text unhung)',
    isActive: (app) => !!effectivePara(app).opticalMargin,
    run: (app) => { const on = !!effectivePara(app).opticalMargin; applyPara(app, 'Optical Margin Alignment', { opticalMargin: on ? undefined : true }); },
  },
  {
    id: 'text.opticalMarginStory', label: 'Optical Margins for Story', icon: 'format_align_justify', tab: 'Text', group: 'Typography', kind: 'toggle', edits: true,
    tip: 'Optical margin alignment for every paragraph of the selected story (a paragraph\'s own setting still wins)',
    isActive: (app) => { const f = activeTextEditor()?.frame || textTargets(app)[0]; return !!(f && app.pub.story(f.story)?.opticalMargin); },
    run: (app) => {
      const f = activeTextEditor()?.frame || textTargets(app)[0];
      const s = f && app.pub.story(f.story);
      if (!s) { toast('Select a text frame first.'); return; }
      if (activeTextEditor()) app.tab.ui.commitText();
      app.pub.transact('Optical Margins for Story', () => { const st = app.pub.story(s.id)!; if (st.opticalMargin) delete st.opticalMargin; else st.opticalMargin = true; });
    },
  },
  {
    id: 'text.opticalMarginSize', label: 'Optical Margin Size…', icon: 'format_size', tab: 'Text', group: 'Typography', edits: true,
    tip: 'The type size the overhang is tuned for: text of that size hangs by the full amount, larger text by less, smaller by more',
    run: async (app, size?: number) => {
      let v = size;
      if (typeof v !== 'number') { const r = await openDialog({ title: 'Optical Margin Size', fields: [{ key: 's', label: 'Reference size (pt)', type: 'number', min: 1, max: 999, step: 0.5, value: app.pub.data.opticalMarginSize || 12, autofocus: true }], help: 'Set it to the body text size for the usual result. Applies to every paragraph with optical margin alignment on.' }); if (!r) return; v = +r.s; }
      if (!(v! > 0)) return;
      app.pub.transact('Optical Margin Size', () => { app.pub.data.opticalMarginSize = v; });
    },
  },
  { id: 'fmt.baselineGridAlign', label: 'Align to Baseline Grid', icon: 'align_vertical_bottom', tab: 'Text', group: 'Typography', kind: 'toggle', edits: true, tip: 'Snap this paragraph\'s baselines to the publication\'s baseline grid', isActive: (app) => !!effectivePara(app).gridAlign, run: (app) => { const on = !!effectivePara(app).gridAlign; applyPara(app, 'Align to Baseline Grid', { gridAlign: on ? undefined : true }); } },
  {
    id: 'fmt.tabs', label: 'Tabs…', icon: 'keyboard_tab', tab: 'Text', group: 'Typography', edits: true,
    run: async (app) => {
      const cur = effectivePara(app);
      const r = await openDialog({ title: 'Tab Stops', fields: [{ key: 't', label: 'One tab stop per line: position in points, then l (left), c (center), r (right) or d (decimal), then an optional leader character', type: 'textarea', rows: 6, value: (cur.tabs || []).map((t) => `${t.pos} ${{ l: 'l', ctr: 'c', r: 'r', dec: 'd' }[t.align]}${t.leader ? ' ' + t.leader : ''}`).join('\n') || '72 l\n144 l\n216 l' }], help: 'Example: "300 r ." makes a right-aligned stop at 300 pt with a dotted leader. Press Tab in the text to move to the next stop.' });
      if (!r) return;
      applyPara(app, 'Tabs', { tabs: parseTabs(r.t) });
    },
  },
  { id: 'fmt.keepWithNext', label: 'Keep with Next', icon: 'vertical_align_bottom', tab: 'Text', group: 'Paragraph Flow', kind: 'toggle', edits: true, tip: 'Never leave this paragraph at the bottom of a column without the next one', isActive: (app) => !!effectivePara(app).keepWithNext, run: (app) => { const on = !!effectivePara(app).keepWithNext; applyPara(app, 'Keep with Next', { keepWithNext: on ? undefined : true }); } },
  { id: 'fmt.keepLines', label: 'Keep Lines Together', icon: 'compress', tab: 'Text', group: 'Paragraph Flow', kind: 'toggle', edits: true, tip: 'Do not split this paragraph between columns or frames', isActive: (app) => !!effectivePara(app).keepLines, run: (app) => { const on = !!effectivePara(app).keepLines; applyPara(app, 'Keep Lines Together', { keepLines: on ? undefined : true }); } },
  {
    id: 'fmt.ruleAbove', label: 'Rule Above', icon: 'border_top', tab: 'Text', group: 'Paragraph Flow', kind: 'split', edits: true, origin: 'Paragraph rules (Ventura Publisher)',
    isActive: (app) => !!effectivePara(app).ruleAbove,
    menu: () => [{ id: 'fmt.ruleAbove', arg: 0.5, label: 'Hairline (0.5 pt)' }, { id: 'fmt.ruleAbove', arg: 1, label: '1 pt' }, { id: 'fmt.ruleAbove', arg: 2, label: '2 pt' }, { id: 'fmt.ruleAbove', arg: 4, label: '4 pt' }, { separator: true }, { id: 'fmt.ruleAbove', arg: 0, label: 'None' }],
    run: (app, w?: number) => { const on = !!effectivePara(app).ruleAbove; const width = w === undefined ? (on ? 0 : 0.5) : +w; applyPara(app, 'Rule Above', (p) => ({ ruleAbove: width > 0 ? { width, color: p.ruleAbove?.color || '#000000', offset: p.ruleAbove?.offset } : undefined })); },
  },
  {
    id: 'fmt.ruleBelow', label: 'Rule Below', icon: 'border_bottom', tab: 'Text', group: 'Paragraph Flow', kind: 'split', edits: true,
    isActive: (app) => !!effectivePara(app).ruleBelow,
    menu: () => [{ id: 'fmt.ruleBelow', arg: 0.5, label: 'Hairline (0.5 pt)' }, { id: 'fmt.ruleBelow', arg: 1, label: '1 pt' }, { id: 'fmt.ruleBelow', arg: 2, label: '2 pt' }, { id: 'fmt.ruleBelow', arg: 4, label: '4 pt' }, { separator: true }, { id: 'fmt.ruleBelow', arg: 0, label: 'None' }],
    run: (app, w?: number) => { const on = !!effectivePara(app).ruleBelow; const width = w === undefined ? (on ? 0 : 0.5) : +w; applyPara(app, 'Rule Below', (p) => ({ ruleBelow: width > 0 ? { width, color: p.ruleBelow?.color || '#000000', offset: p.ruleBelow?.offset } : undefined })); },
  },
  {
    id: 'fmt.language', label: 'Text Language', icon: 'language', tab: 'Text', group: 'Typography', edits: true,
    tip: 'The language of the selected text (for spelling and hyphenation)',
    run: async (app) => { const r = await promptDialog('Text Language', 'Language tag (BCP 47, e.g. en-US, fr, de-CH; empty = the publication language)', effectiveRun(app).lang || ''); if (r == null) return; applyRun(app, 'Language', { lang: r.trim() || undefined }); },
  },
]);

// ------------------------------------------------------------------------------------------
// Style sheets

def([
  {
    id: 'fmt.newParaStyle', label: 'New Paragraph Style…', icon: 'add', tab: 'Home', group: 'Styles', edits: true,
    tip: 'A new style from the formatting at the caret',
    run: async (app) => {
      const base = currentPara(app);
      const { runs: _r, end: _e, style, ...props } = base as any;
      const run = { ...currentRun(app) }; delete (run as any).text; delete (run as any).field;
      const st = await paraStyleDialog(app, { name: '', basedOn: style, ...props, run } as ParaStyle);
      if (!st) return;
      app.pub.transact('New Paragraph Style', () => { app.pub.data.styles.para.push(st); });
      applyPara(app, 'Paragraph Style', () => ({ style: st.name }));
    },
  },
  {
    id: 'fmt.modifyParaStyle', label: 'Modify Paragraph Style…', icon: 'edit', tab: 'Home', group: 'Styles', edits: true,
    run: async (app, name?: string) => {
      const n = name || currentPara(app).style || 'Body';
      const st = app.pub.paraStyle(n);
      if (!st) { toast(`No paragraph style named "${n}".`); return; }
      const out = await paraStyleDialog(app, st);
      if (!out) return;
      app.pub.transact('Modify Paragraph Style', () => { const i = app.pub.data.styles.para.indexOf(st); app.pub.data.styles.para[i] = out; if (out.name !== st.name) renameParaStyle(app, st.name, out.name); });
    },
  },
  {
    id: 'fmt.redefineStyle', label: 'Redefine Style from Selection', icon: 'sync_alt', tab: 'Home', group: 'Styles', edits: true, origin: 'Redefine style (page layout programs)',
    tip: 'Make the paragraph style look like the formatting at the caret, and remove the local overrides',
    run: (app, name?: string) => {
      const p = currentPara(app);
      const n = name || p.style || 'Body';
      const st = app.pub.paraStyle(n);
      if (!st) { toast(`No paragraph style named "${n}".`); return; }
      const { runs: _r, end: _e, style: _s, ...props } = p as any;
      const run = { ...currentRun(app) }; delete (run as any).text; delete (run as any).field; delete (run as any).cstyle;
      app.pub.transact('Redefine Style', () => { Object.assign(st, props); st.run = { ...(st.run || {}), ...run }; });
      applyPara(app, 'Redefine Style', () => ({ ...Object.fromEntries(Object.keys(props).map((k) => [k, undefined])), style: n }));
      applyRun(app, 'Redefine Style', (r) => Object.fromEntries(Object.keys(run).map((k) => [k, undefined])) as any);
      toast(`"${n}" redefined`);
    },
  },
  {
    id: 'fmt.duplicateStyle', label: 'Duplicate Paragraph Style', icon: 'content_copy', tab: 'Home', group: 'Styles', edits: true,
    run: async (app, name?: string) => {
      const st = app.pub.paraStyle(name || currentPara(app).style || 'Body');
      if (!st) return;
      let n = `${st.name} copy`, k = 2;
      while (app.pub.paraStyle(n)) n = `${st.name} copy ${k++}`;
      const out = await paraStyleDialog(app, { ...clone(st), name: n });
      if (out) app.pub.transact('Duplicate Style', () => { app.pub.data.styles.para.push(out); });
    },
  },
  {
    id: 'fmt.deleteStyle', label: 'Delete Paragraph Style…', icon: 'delete', tab: 'Home', group: 'Styles', edits: true,
    run: async (app, name?: string) => {
      const pub = app.pub;
      const n = name || currentPara(app).style || 'Body';
      const st = pub.paraStyle(n);
      if (!st) return;
      if (pub.data.styles.para.length < 2) { toast('A publication needs at least one paragraph style.'); return; }
      const others = pub.data.styles.para.filter((s) => s !== st).map((s) => s.name);
      const r = await openDialog({ title: 'Delete Paragraph Style', fields: [{ key: 'to', label: `Paragraphs using "${n}" change to`, type: 'select', options: others, value: others.includes('Body') ? 'Body' : others[0] }], ok: 'Delete' });
      if (!r) return;
      pub.transact('Delete Style', () => { pub.data.styles.para = pub.data.styles.para.filter((s) => s !== st); renameParaStyle(app, n, r.to); });
    },
  },
  {
    id: 'fmt.newCharStyle', label: 'New Character Style…', icon: 'add', tab: 'Home', group: 'Styles', edits: true,
    run: async (app) => {
      const run = { ...currentRun(app) }; delete (run as any).text; delete (run as any).field; delete (run as any).cstyle;
      const st = await charStyleDialog(app, { name: '', ...run });
      if (!st) return;
      app.pub.transact('New Character Style', () => { app.pub.data.styles.char.push(st); });
      applyRun(app, 'Character Style', { cstyle: st.name });
    },
  },
  {
    id: 'fmt.modifyCharStyle', label: 'Modify Character Style…', icon: 'edit', tab: 'Home', group: 'Styles', edits: true,
    run: async (app, name?: string) => {
      const n = name || currentRun(app).cstyle;
      const st = n ? app.pub.charStyle(n) : undefined;
      if (!st) { toast('Select text that uses a character style, or choose one in the Styles pane.'); return; }
      const out = await charStyleDialog(app, st);
      if (!out) return;
      app.pub.transact('Modify Character Style', () => { const i = app.pub.data.styles.char.indexOf(st); app.pub.data.styles.char[i] = out; if (out.name !== st.name) renameCharStyle(app, st.name, out.name); });
    },
  },
  {
    id: 'fmt.redefineCharStyle', label: 'Redefine Character Style from Selection', icon: 'sync_alt', tab: 'Home', group: 'Styles', edits: true,
    run: (app, name?: string) => {
      const r = currentRun(app);
      const n = name || r.cstyle;
      const st = n ? app.pub.charStyle(n) : undefined;
      if (!st) { toast('Select text that uses a character style first.'); return; }
      const run = { ...r }; delete (run as any).text; delete (run as any).field; delete (run as any).cstyle;
      app.pub.transact('Redefine Character Style', () => { for (const k of Object.keys(st)) if (k !== 'name' && k !== 'basedOn') delete (st as any)[k]; Object.assign(st, run); });
      applyRun(app, 'Redefine Character Style', () => ({ ...Object.fromEntries(Object.keys(run).map((k) => [k, undefined])), cstyle: n }) as any);
    },
  },
  {
    id: 'fmt.duplicateCharStyle', label: 'Duplicate Character Style', icon: 'content_copy', tab: 'Home', group: 'Styles', edits: true,
    run: async (app, name?: string) => {
      const st = name ? app.pub.charStyle(name) : app.pub.charStyle(currentRun(app).cstyle || '');
      if (!st) return;
      let n = `${st.name} copy`, k = 2;
      while (app.pub.charStyle(n)) n = `${st.name} copy ${k++}`;
      const out = await charStyleDialog(app, { ...clone(st), name: n });
      if (out) app.pub.transact('Duplicate Character Style', () => { app.pub.data.styles.char.push(out); });
    },
  },
  {
    id: 'fmt.deleteCharStyle', label: 'Delete Character Style…', icon: 'delete', tab: 'Home', group: 'Styles', edits: true,
    run: async (app, name?: string) => {
      const pub = app.pub;
      const n = name || currentRun(app).cstyle;
      const st = n ? pub.charStyle(n) : undefined;
      if (!st) return;
      if (!(await confirmDialog('Delete Character Style', `Delete "${n}"? Text using it keeps its other formatting.`, 'Delete'))) return;
      pub.transact('Delete Character Style', () => { pub.data.styles.char = pub.data.styles.char.filter((s) => s !== st); renameCharStyle(app, n!, undefined); });
    },
  },
  {
    id: 'fmt.selectByStyle', label: 'Select Frames by Style…', icon: 'select', tab: 'Home', group: 'Styles', noRecord: true,
    tip: 'Select every text frame on this page whose text uses a style',
    run: async (app, arg?: { kind: string; name: string }) => {
      const pub = app.pub;
      let kind = arg?.kind, name = arg?.name;
      if (!name) {
        const r = await openDialog({ title: 'Select by Style', fields: [{ key: 'k', label: 'Kind', type: 'radio', options: [{ value: 'para', label: 'Paragraph style' }, { value: 'char', label: 'Character style' }, { value: 'object', label: 'Object style' }], value: 'para' }, { key: 'p', label: 'Paragraph style', type: 'select', options: pub.data.styles.para.map((s) => s.name), value: 'Body', visibleIf: (v) => v.k === 'para' }, { key: 'c', label: 'Character style', type: 'select', options: pub.data.styles.char.map((s) => s.name), visibleIf: (v) => v.k === 'char' }, { key: 'o', label: 'Object style', type: 'select', options: pub.data.styles.object.map((s) => s.name), visibleIf: (v) => v.k === 'object' }] });
        if (!r) return; kind = r.k; name = r.k === 'para' ? r.p : r.k === 'char' ? r.c : r.o;
      }
      const o = app.owner; if (!o) return;
      const uses = (f: TextFrame) => { const s = pub.story(f.story); if (!s) return false; return kind === 'para' ? s.paras.some((p) => (p.style || 'Body') === name) : s.paras.some((p) => p.runs.some((r) => r.cstyle === name)); };
      const ids = o.items.filter((e) => (kind === 'object' ? e.ostyle === name : e.kind === 'text' && uses(e))).map((e) => e.id);
      if (!ids.length) { toast(`No objects on this page use "${name}".`); return; }
      app.tab.ui.select(ids);
    },
  },
  {
    id: 'fmt.importStyles', label: 'Load Styles from Publication…', icon: 'upload', tab: 'Home', group: 'Styles', edits: true, origin: 'Load Styles (page layout programs)',
    tip: 'Copy the paragraph, character and object styles (and swatches) of another .qpp or .sla file into this publication',
    run: async (app) => {
      const f = (await pickFile('.qpp,.json,.sla'))[0];
      if (!f) return;
      const { importPublication } = await import('../io');
      let src;
      try { src = (await importPublication(new Uint8Array(await f.arrayBuffer()), f.name, { noRecovery: true })).pub; } catch (e: any) { toast(`Could not read ${f.name}: ${e?.message || e}`); return; }
      const r = await openDialog({ title: 'Load Styles', fields: [{ key: 'para', label: `Paragraph styles (${src.data.styles.para.length})`, type: 'checkbox', value: true }, { key: 'char', label: `Character styles (${src.data.styles.char.length})`, type: 'checkbox', value: true }, { key: 'obj', label: `Object styles (${src.data.styles.object.length})`, type: 'checkbox', value: true }, { key: 'sw', label: `Swatches (${src.data.swatches.length})`, type: 'checkbox', value: true }, { key: 'over', label: 'Replace styles with the same name', type: 'checkbox', value: false }], ok: 'Load' });
      if (!r) return;
      const pub = app.pub;
      let n = 0;
      const merge = <T extends { name: string }>(dst: T[], add: T[]) => { for (const s of add) { const i = dst.findIndex((x) => x.name === s.name); if (i < 0) { dst.push(clone(s)); n++; } else if (r.over) { dst[i] = clone(s); n++; } } };
      pub.transact('Load Styles', () => {
        if (r.para) merge(pub.data.styles.para, src.data.styles.para);
        if (r.char) merge(pub.data.styles.char, src.data.styles.char);
        if (r.obj) merge(pub.data.styles.object, src.data.styles.object);
        if (r.sw) merge(pub.data.swatches, src.data.swatches);
      });
      toast(`Loaded ${n} style(s) and swatch(es) from ${f.name}.`);
    },
  },
  {
    id: 'fmt.styleChain', label: 'Style Inheritance…', icon: 'account_tree', tab: 'Home', group: 'Styles', noRecord: true,
    tip: 'Show what the paragraph style at the caret is based on and the formatting it resolves to',
    run: async (app) => {
      const chain = paraChain(app.pub.data, currentPara(app).style || 'Body');
      const r = effectiveRun(app), p = effectivePara(app);
      await openDialog({ title: 'Style Inheritance', ok: 'Close', cancel: false, fields: [{ key: 'i', type: 'info', html: `<p><b>${chain.map((s) => s.name).reverse().join(' → ') || '(none)'}</b></p><p>Resolves to: ${r.font || DEFAULT_BODY_FONT} ${r.size || 11} pt${r.b ? ', bold' : ''}${r.i ? ', italic' : ''}; align ${p.align || 'left'}; leading ${p.lineSpacingPt ? `${p.lineSpacing} pt` : `${p.lineSpacing ?? 120}%`}; space ${p.spaceBefore || 0}/${p.spaceAfter || 0} pt.</p>` }] });
    },
  },
]);

