/**
 * IDML (InDesign Markup Language) resources and stories: colors, tints and gradients
 * (Resources/Graphic.xml), paragraph, character and object styles (Resources/Styles.xml) and the
 * story text (Stories/*.xml) with its paragraph and character style ranges. Written from Adobe's
 * public IDML specification; src/io/idml.ts reads the package and the spreads.
 */
import type { Pub } from '../model/pub';
import { newId } from '../model/pub';
import type { Bullet, CharStyle, Fill, ObjectStyle, ParaProps, ParaStyle, Paragraph, Run, RunProps, Story } from '../model/types';
import { kids, kid } from './xml';
import { cmykToHex, hexToCmyk } from '../model/styles';

/** Attributes of an element merged with its <Properties> children (unit, string, enumeration, object, boolean, list). */
export function props(el: Element): Record<string, any> {
  const out: Record<string, any> = {};
  for (const a of Array.from(el.attributes)) out[a.name] = a.value;
  const p = kid(el, 'Properties');
  if (p) {
    for (const c of kids(p)) {
      const t = c.getAttribute('type');
      if (t === 'list') out[c.localName] = kids(c).map((li) => li.textContent || '');
      else if (t === 'unit' || t === 'long' || t === 'double') out[c.localName] = parseFloat(c.textContent || '');
      else if (t === 'boolean') out[c.localName] = (c.textContent || '').trim() === 'true';
      else out[c.localName] = (c.textContent || '').trim();
    }
  }
  return out;
}

const numOf = (v: any): number | undefined => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : undefined; };

/** "ParagraphStyle/Heads%3aH1" → "Heads:H1"; "$ID/NormalParagraphStyle" keeps its tail. */
export function idName(self: string | null | undefined): string {
  if (!self) return '';
  let s = self.replace(/^(ParagraphStyle|CharacterStyle|ObjectStyle|Color|Swatch|Tint|Gradient|StrokeStyle|TableStyle|CellStyle)\//, '');
  s = s.replace(/^\$ID\//, '');
  try { s = decodeURIComponent(s.replace(/%(?![0-9a-f]{2})/gi, '%25')); } catch { /* keep */ }
  return s;
}

// ------------------------------------------------------------------------------------------
// Colors

export interface ColorTable { of(ref: string | null | undefined): string | undefined; fill(ref: string | null | undefined, tint?: number): Fill | undefined }

function labToHex(L: number, a: number, b: number): string {
  let y = (L + 16) / 116, x = a / 500 + y, z = y - b / 200;
  const f = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  x = 0.95047 * f(x); y = 1 * f(y); z = 1.08883 * f(z);
  let r = x * 3.2406 + y * -1.5372 + z * -0.4986, g = x * -0.9689 + y * 1.8758 + z * 0.0415, bb = x * 0.0557 + y * -0.204 + z * 1.057;
  const gam = (c: number) => { c = c > 0.0031308 ? 1.055 * c ** (1 / 2.4) - 0.055 : 12.92 * c; return Math.max(0, Math.min(255, Math.round(c * 255))); };
  r = gam(r); g = gam(g); bb = gam(bb);
  return '#' + [r, g, bb].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function tintHex(hex: string, pct: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const k = Math.max(0, Math.min(100, pct)) / 100;
  const ch = (h: string) => Math.round(255 - (255 - parseInt(h, 16)) * k).toString(16).padStart(2, '0');
  return `#${ch(m[1])}${ch(m[2])}${ch(m[3])}`.toUpperCase();
}

/** Reads Resources/Graphic.xml into the publication's swatches and returns a lookup for fill/stroke references. */
export function readColors(pub: Pub, graphic: Document | null): ColorTable {
  const P = pub.data;
  const bySelf = new Map<string, string>(); // Self → swatch name or hex
  const gradients = new Map<string, Fill>();
  bySelf.set('Color/Black', 'Black'); bySelf.set('Color/Paper', 'White'); bySelf.set('Color/Registration', 'Black');
  bySelf.set('Color/None', 'none'); bySelf.set('Swatch/None', 'none');
  const root = graphic?.documentElement;
  for (const c of root ? kids(root) : []) {
    const self = c.getAttribute('Self') || '';
    if (c.localName === 'Color') {
      const space = c.getAttribute('Space') || 'CMYK';
      const vals = (c.getAttribute('ColorValue') || '').trim().split(/\s+/).map(parseFloat);
      let hex = '';
      if (space === 'CMYK' && vals.length >= 4) hex = cmykToHex(vals[0], vals[1], vals[2], vals[3]);
      else if (space === 'RGB' && vals.length >= 3) hex = '#' + vals.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
      else if (space === 'LAB' && vals.length >= 3) hex = labToHex(vals[0], vals[1], vals[2]);
      if (!hex) continue;
      const name = idName(c.getAttribute('Name') || self).replace(/^\[|\]$/g, '') || self;
      if (bySelf.has(self) && ['Color/Black', 'Color/Paper', 'Color/Registration'].includes(self)) continue;
      const existing = P.swatches.find((s) => s.name === name);
      if (existing) existing.color = hex;
      else P.swatches.push({ name, color: hex, ...(space === 'CMYK' ? { cmyk: [vals[0], vals[1], vals[2], vals[3]] as [number, number, number, number] } : { cmyk: hexToCmyk(hex) }), ...(c.getAttribute('Model') === 'Spot' ? { spot: true } : {}) });
      bySelf.set(self, name);
    } else if (c.localName === 'Tint') {
      const base = bySelf.get(c.getAttribute('BaseColor') || '');
      const sw = base ? P.swatches.find((s) => s.name === base) : undefined;
      const pct = numOf(c.getAttribute('TintValue')) ?? 100;
      if (sw) {
        const name = `${sw.name} ${Math.round(pct)}%`;
        if (!P.swatches.some((s) => s.name === name)) P.swatches.push({ name, color: tintHex(sw.color, pct), cmyk: hexToCmyk(tintHex(sw.color, pct)) });
        bySelf.set(self, name);
      }
    } else if (c.localName === 'Gradient') {
      const stops = kids(c).filter((k) => k.localName === 'GradientStop').map((s) => ({ pos: (numOf(s.getAttribute('Location')) ?? 0) / 100, color: bySelf.get(s.getAttribute('StopColor') || '') || '#000000' }));
      if (stops.length) gradients.set(self, { type: 'gradient', stops, path: c.getAttribute('Type') === 'Radial' ? 'radial' : 'linear', angle: 0 });
    }
  }
  const of = (ref: string | null | undefined) => { if (!ref) return undefined; const v = bySelf.get(ref); if (v) return v === 'none' ? undefined : v; return undefined; };
  return {
    of,
    fill(ref, tint) {
      if (!ref || ref === 'Swatch/None' || ref === 'Color/None') return undefined;
      const g = gradients.get(ref);
      if (g) return g;
      const name = of(ref);
      if (!name) return undefined;
      if (tint != null && tint >= 0 && tint < 100) { const sw = P.swatches.find((s) => s.name === name); if (sw) return { type: 'solid', color: tintHex(sw.color, tint) }; }
      return { type: 'solid', color: name };
    },
  };
}

// ------------------------------------------------------------------------------------------
// Styles

export interface StyleTable { para(ref: string | null | undefined): string | undefined; char(ref: string | null | undefined): string | undefined; object(ref: string | null | undefined): string | undefined; fonts: Set<string> }

const ALIGN: Record<string, ParaProps['align']> = { LeftAlign: 'l', CenterAlign: 'ctr', RightAlign: 'r', LeftJustified: 'just', RightJustified: 'just', CenterJustified: 'just', FullyJustified: 'justAll', ToBindingSide: 'l', AwayFromBindingSide: 'r' };

/** Run properties from a style or range element's attributes. */
export function runPropsOf(a: Record<string, any>, colors: ColorTable, fonts?: Set<string>): RunProps {
  const r: RunProps = {};
  const size = numOf(a.PointSize);
  if (size) r.size = size;
  const font = typeof a.AppliedFont === 'string' ? a.AppliedFont : undefined;
  if (font) { r.font = font; fonts?.add(font); }
  const fs = String(a.FontStyle || '');
  if (/bold|black|heavy|semibold|demi/i.test(fs)) r.b = true;
  if (/italic|oblique/i.test(fs)) r.i = true;
  if (a.FontStyle && !r.b && !r.i && /regular|roman|book|medium|light/i.test(fs)) { r.b = false; r.i = false; }
  const color = colors.of(a.FillColor);
  if (color) r.color = color;
  if (a.Underline === 'true' || a.Underline === true) r.u = true;
  if (a.StrikeThru === 'true' || a.StrikeThru === true) r.strike = true;
  if (a.Capitalization === 'AllCaps' || a.Capitalization === 'CapToSmallCap') r.caps = a.Capitalization === 'AllCaps' ? 'all' : 'small';
  else if (a.Capitalization === 'SmallCaps') r.caps = 'small';
  else if (a.Capitalization === 'Normal') r.caps = 'none';
  if (a.Position === 'Superscript' || a.Position === 'OTSuperscript') r.baseline = 33;
  else if (a.Position === 'Subscript' || a.Position === 'OTSubscript') r.baseline = -33;
  const tracking = numOf(a.Tracking);
  if (tracking) r.spc = Math.round(((size || 10) * tracking) / 10) / 100;
  if (a.Ligatures === 'false' || a.Ligatures === false) r.liga = false;
  if (a.KerningMethod === '$ID/Metrics' || a.KerningMethod === '$ID/Optical') r.kern = true;
  if (a.KerningMethod === 'None' || a.KerningMethod === '$ID/None') r.kern = false;
  return r;
}

/** Paragraph properties from a style or range element's attributes. */
export function paraPropsOf(a: Record<string, any>, colors: ColorTable): ParaProps {
  const p: ParaProps = {};
  if (a.Justification && ALIGN[a.Justification]) p.align = ALIGN[a.Justification];
  const n = (k: string) => numOf(a[k]);
  if (n('LeftIndent')) p.marL = n('LeftIndent');
  if (n('RightIndent')) p.marR = n('RightIndent');
  if (n('FirstLineIndent')) p.indent = n('FirstLineIndent');
  if (n('SpaceBefore')) p.spaceBefore = n('SpaceBefore');
  if (n('SpaceAfter')) p.spaceAfter = n('SpaceAfter');
  const leading = a.Leading;
  if (typeof leading === 'number' && leading > 0) { p.lineSpacing = leading; p.lineSpacingPt = true; }
  else if (typeof leading === 'string' && /^[\d.]+$/.test(leading)) { p.lineSpacing = parseFloat(leading); p.lineSpacingPt = true; }
  if (a.Hyphenation === 'true' || a.Hyphenation === true) p.hyphenate = true;
  else if (a.Hyphenation === 'false' || a.Hyphenation === false) p.hyphenate = false;
  const dl = n('DropCapLines'), dc = n('DropCapCharacters');
  if (dl && dl > 1) p.dropCap = { lines: dl, chars: dc || 1 };
  if (n('KeepWithNext')) p.keepWithNext = true;
  if (a.KeepLinesTogether === 'true' || a.KeepLinesTogether === true) p.keepLines = true;
  if (a.AlignToBaseline === 'true' || a.AlignToBaseline === true) p.gridAlign = true;
  const list = a.BulletsAndNumberingListType;
  if (list === 'BulletList') p.bullet = { kind: 'char', char: '•' } as Bullet;
  else if (list === 'NumberedList') p.bullet = { kind: 'num', scheme: 'arabicPeriod' } as Bullet;
  const tabs = Array.isArray(a.TabList) ? a.TabList : undefined;
  void tabs;
  if (a.RuleAbove === 'true' || a.RuleAbove === true) p.ruleAbove = { width: n('RuleAboveLineWeight') || 1, color: colors.of(a.RuleAboveColor) || 'Black', offset: n('RuleAboveOffset') || 0 };
  if (a.RuleBelow === 'true' || a.RuleBelow === true) p.ruleBelow = { width: n('RuleBelowLineWeight') || 1, color: colors.of(a.RuleBelowColor) || 'Black', offset: n('RuleBelowOffset') || 0 };
  return p;
}

/** Tab stops from a style's <TabList> property (list of ListItem records). */
function tabsOf(el: Element): ParaProps['tabs'] | undefined {
  const p = kid(el, 'Properties');
  const tl = p && kid(p, 'TabList');
  if (!tl) return undefined;
  const out: NonNullable<ParaProps['tabs']> = [];
  for (const li of kids(tl)) {
    const pos = numOf(kid(li, 'Position')?.textContent);
    if (pos == null) continue;
    const al = (kid(li, 'Alignment')?.textContent || 'LeftAlign').trim();
    const leader = (kid(li, 'Leader')?.textContent || '').trim();
    out.push({ pos, align: al === 'CenterAlign' ? 'ctr' : al === 'RightAlign' ? 'r' : al === 'CharacterAlign' ? 'dec' : 'l', ...(leader ? { leader } : {}) });
  }
  return out.length ? out : undefined;
}

/** Reads Resources/Styles.xml into the publication's style sheets. */
export function readStyles(pub: Pub, styles: Document | null, colors: ColorTable): StyleTable {
  const P = pub.data;
  const paraBySelf = new Map<string, string>(), charBySelf = new Map<string, string>(), objBySelf = new Map<string, string>();
  const fonts = new Set<string>();
  paraBySelf.set('ParagraphStyle/$ID/NormalParagraphStyle', 'Body');
  paraBySelf.set('ParagraphStyle/$ID/[No paragraph style]', 'Body');
  charBySelf.set('CharacterStyle/$ID/[No character style]', '');
  const root = styles?.documentElement;
  const walk = (el: Element, fn: (e: Element) => void, names: string[]) => { for (const c of kids(el)) { if (names.includes(c.localName)) fn(c); else if (/Group$/.test(c.localName)) walk(c, fn, names); } };
  if (!root) return { para: (r) => paraBySelf.get(r || ''), char: (r) => charBySelf.get(r || ''), object: (r) => objBySelf.get(r || ''), fonts };
  const nameOf = (e: Element) => { const n = idName(e.getAttribute('Name') || e.getAttribute('Self')); return n.replace(/^\[|\]$/g, ''); };
  // Paragraph styles: two passes so BasedOn/NextStyle can name styles declared later.
  const paraEls: Element[] = [];
  walk(root, (e) => paraEls.push(e), ['ParagraphStyle']);
  for (const e of paraEls) { const self = e.getAttribute('Self') || ''; if (!paraBySelf.has(self)) paraBySelf.set(self, nameOf(e) === 'NormalParagraphStyle' ? 'Body' : nameOf(e)); }
  for (const e of paraEls) {
    const self = e.getAttribute('Self') || '';
    const name = paraBySelf.get(self)!;
    const a = props(e);
    const st: ParaStyle = { name, ...paraPropsOf(a, colors) };
    const run = runPropsOf(a, colors, fonts);
    if (Object.keys(run).length) st.run = run;
    const based = paraBySelf.get(String(a.BasedOn || ''));
    if (based && based !== name) st.basedOn = based;
    const next = paraBySelf.get(String(a.NextStyle || ''));
    if (next && next !== name) st.next = next;
    const tabs = tabsOf(e);
    if (tabs) st.tabs = tabs;
    const ex = P.styles.para.find((s) => s.name === name);
    if (ex) Object.assign(ex, st); else P.styles.para.push(st);
  }
  walk(root, (e) => {
    const self = e.getAttribute('Self') || '';
    if (charBySelf.has(self)) return;
    const name = nameOf(e);
    if (!name || /^\[?No character style\]?$/.test(name)) { charBySelf.set(self, ''); return; }
    const a = props(e);
    const cs: CharStyle = { name, ...runPropsOf(a, colors, fonts) };
    const based = charBySelf.get(String(a.BasedOn || ''));
    if (based && based !== name) cs.basedOn = based;
    charBySelf.set(self, name);
    const ex = P.styles.char.find((s) => s.name === name);
    if (ex) Object.assign(ex, cs); else P.styles.char.push(cs);
  }, ['CharacterStyle']);
  walk(root, (e) => {
    const self = e.getAttribute('Self') || '';
    const name = nameOf(e);
    if (!name || /^\[?(None|Normal Graphics Frame|Normal Text Frame|Normal Grid)\]?$/.test(name)) { objBySelf.set(self, ''); return; }
    const a = props(e);
    const os: ObjectStyle = { name };
    const fill = colors.fill(a.FillColor, numOf(a.FillTint));
    if (fill) os.fill = fill;
    const sw = numOf(a.StrokeWeight);
    const sc = colors.of(a.StrokeColor);
    if (sc && sw) os.line = { fill: { type: 'solid', color: sc }, width: sw };
    objBySelf.set(self, name);
    if (!P.styles.object.some((s) => s.name === name)) P.styles.object.push(os);
  }, ['ObjectStyle']);
  return { para: (r) => paraBySelf.get(r || ''), char: (r) => charBySelf.get(r || ''), object: (r) => objBySelf.get(r || ''), fonts };
}

// ------------------------------------------------------------------------------------------
// Stories

export interface StoryRead { story: Story; anchored: Element[]; notes: number; tables: number; footnotes: number }

interface Ctx { pub: Pub; colors: ColorTable; styles: StyleTable; paras: Paragraph[]; cur: Paragraph; paraStyle: string; paraOverrides: ParaProps; run: RunProps; cstyle: string; anchored: Element[]; notes: number; tables: number; footnotes: { id: string; paras: Paragraph[] }[]; inFootnote: boolean; fresh: boolean }

/** The publication model carries footnotes on stories (Story.footnotes); kept as a switch for older models. */
function modelHasFootnotes(_pub: Pub): boolean { return true; }

function pushRun(ctx: Ctx, run: Run): void {
  const last = ctx.cur.runs[ctx.cur.runs.length - 1];
  if (last && !last.br && !run.br && !last.field && !run.field && !(last as any).anchor && !(run as any).anchor && !(last as any).footnote && !(run as any).footnote && sameProps(last, run)) last.text += run.text;
  else ctx.cur.runs.push(run);
}

function sameProps(a: Run, b: Run): boolean {
  const ka = Object.keys(a).filter((k) => k !== 'text'), kb = Object.keys(b).filter((k) => k !== 'text');
  if (ka.length !== kb.length) return false;
  return ka.every((k) => JSON.stringify((a as any)[k]) === JSON.stringify((b as any)[k]));
}

function newPara(ctx: Ctx): Paragraph {
  return { style: ctx.paraStyle, ...ctx.paraOverrides, runs: [] };
}

function endPara(ctx: Ctx): void {
  ctx.paras.push(ctx.cur);
  ctx.cur = newPara(ctx);
  ctx.fresh = true;
}

function addText(ctx: Ctx, text: string): void {
  if (!text) return;
  const parts = text.split(/\u2028/);
  parts.forEach((part, i) => {
    if (i > 0) pushRun(ctx, { text: '', br: true });
    // Paragraph separators inside Content are rare but legal.
    const paras = part.split(/\u2029/);
    paras.forEach((pp, j) => {
      if (j > 0) endPara(ctx);
      const clean = pp.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/­/g, '');
      if (clean) { pushRun(ctx, { ...ctx.run, ...(ctx.cstyle ? { cstyle: ctx.cstyle } : {}), text: clean }); ctx.fresh = false; }
    });
  });
}

function walkNodes(ctx: Ctx, el: Element): void {
  for (const c of kids(el)) {
    switch (c.localName) {
      case 'ParagraphStyleRange': {
        const a = props(c);
        const style = ctx.styles.para(a.AppliedParagraphStyle) || 'Body';
        const over = paraPropsOf(a, ctx.colors);
        const runOver = runPropsOf(a, ctx.colors);
        const saved = [ctx.paraStyle, ctx.paraOverrides, ctx.run] as const;
        ctx.paraStyle = style; ctx.paraOverrides = over;
        if (ctx.fresh) { ctx.cur.style = style; Object.assign(ctx.cur, over); }
        ctx.run = { ...ctx.run, ...runOver };
        walkNodes(ctx, c);
        [ctx.paraStyle, ctx.paraOverrides, ctx.run] = [saved[0], saved[1], saved[2]];
        break;
      }
      case 'CharacterStyleRange': {
        const a = props(c);
        const savedRun = ctx.run, savedC = ctx.cstyle;
        ctx.cstyle = ctx.styles.char(a.AppliedCharacterStyle) || '';
        ctx.run = { ...savedRun, ...runPropsOf(a, ctx.colors) };
        walkNodes(ctx, c);
        ctx.run = savedRun; ctx.cstyle = savedC;
        break;
      }
      case 'Content': addText(ctx, c.textContent || ''); break;
      case 'Br': endPara(ctx); break;
      case 'Tab': addText(ctx, '\t'); break;
      case 'Footnote': {
        if (ctx.inFootnote) break;
        const inner: Ctx = { ...ctx, paras: [], cur: { style: 'Footnote', runs: [] }, paraStyle: 'Footnote', paraOverrides: {}, run: {}, cstyle: '', inFootnote: true, fresh: true };
        walkNodes(inner, c);
        if (inner.cur.runs.length || !inner.paras.length) inner.paras.push(inner.cur);
        const id = newId('fn');
        ctx.footnotes.push({ id, paras: inner.paras.filter((p) => p.runs.length) });
        const n = String(ctx.footnotes.length);
        if (modelHasFootnotes(ctx.pub)) ctx.cur.runs.push({ ...ctx.run, text: n, footnote: id } as Run);
        else ctx.cur.runs.push({ ...ctx.run, text: n, baseline: 33 });
        ctx.fresh = false;
        break;
      }
      case 'Table': readTable(ctx, c); break;
      case 'Note': ctx.notes++; break;
      case 'TextVariableInstance': addText(ctx, c.getAttribute('ResultText') || ''); break;
      case 'HyperlinkTextSource': case 'HyperlinkTextDestination': case 'Change': case 'XMLElement': case 'XMLAttribute': case 'Cell': case 'Row': walkNodes(ctx, c); break;
      case 'Rectangle': case 'Oval': case 'Polygon': case 'GraphicLine': case 'TextFrame': case 'Group': ctx.anchored.push(c); break;
      case 'Properties': case 'StoryPreference': case 'InCopyExportOption': case 'MetadataPacketPreference': break;
      default: if (c.children.length) walkNodes(ctx, c); break;
    }
  }
}

/** A table inside a story becomes tab-separated rows (one paragraph per row). */
function readTable(ctx: Ctx, t: Element): void {
  ctx.tables++;
  const cells = kids(t).filter((k) => k.localName === 'Cell');
  const rows = new Map<number, Map<number, string>>();
  for (const cell of cells) {
    const [c, r] = (cell.getAttribute('Name') || '0:0').split(':').map((v) => parseInt(v, 10) || 0);
    const inner: Ctx = { ...ctx, paras: [], cur: { style: ctx.paraStyle, runs: [] }, fresh: true, anchored: [], footnotes: [] };
    walkNodes(inner, cell);
    if (inner.cur.runs.length) inner.paras.push(inner.cur);
    const text = inner.paras.map((p) => p.runs.map((x) => (x.br ? ' ' : x.text)).join('')).join(' ').trim();
    if (!rows.has(r)) rows.set(r, new Map());
    rows.get(r)!.set(c, text);
  }
  if (!ctx.fresh) endPara(ctx);
  for (const r of [...rows.keys()].sort((a, b) => a - b)) {
    const cols = rows.get(r)!;
    const line = [...cols.keys()].sort((a, b) => a - b).map((c) => cols.get(c) || '').join('\t');
    addText(ctx, line);
    endPara(ctx);
  }
}

/** Reads a Story element into a QuillPress story (registered on the publication). */
export function readStory(pub: Pub, storyEl: Element, colors: ColorTable, styles: StyleTable): StoryRead {
  const ctx: Ctx = { pub, colors, styles, paras: [], cur: { style: 'Body', runs: [] }, paraStyle: 'Body', paraOverrides: {}, run: {}, cstyle: '', anchored: [], notes: 0, tables: 0, footnotes: [], inFootnote: false, fresh: true };
  walkNodes(ctx, storyEl);
  // The story ends with the open paragraph unless it is the empty remainder after a final Br.
  if (ctx.cur.runs.length || !ctx.paras.length) ctx.paras.push(ctx.cur);
  for (const p of ctx.paras) for (const k of Object.keys(p)) if ((p as any)[k] === undefined) delete (p as any)[k];
  const story = pub.newStory(ctx.paras, storyEl.getAttribute('StoryTitle') || undefined);
  if (ctx.footnotes.length) {
    if (modelHasFootnotes(pub)) (story as any).footnotes = ctx.footnotes;
    else {
      story.paras.push({ style: 'Heading 3', runs: [{ text: 'Notes' }] });
      ctx.footnotes.forEach((f, i) => { const [first, ...rest] = f.paras.length ? f.paras : [{ style: 'Footnote', runs: [] }]; story.paras.push({ ...first, style: 'Body', runs: [{ text: `${i + 1}. ` }, ...first.runs] }, ...rest.map((p) => ({ ...p, style: 'Body' }))); });
    }
  }
  return { story, anchored: ctx.anchored, notes: ctx.notes, tables: ctx.tables, footnotes: ctx.footnotes.length };
}
