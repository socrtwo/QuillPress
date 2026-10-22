/**
 * IDML export, text side: colors (Resources/Graphic.xml), styles (Resources/Styles.xml), fonts
 * (Resources/Fonts.xml) and stories (Stories/Story_*.xml) with their paragraph and character style
 * ranges, footnotes, hyperlinks, anchored objects and tables. src/io/idmlExport.ts writes the package,
 * the spreads and the items. This is the inverse of src/io/idmlText.ts, written from Adobe's public
 * IDML specification; the conventions (Self ids, Properties children, enumerations) are the ones the
 * importer reads back.
 */
import type { Pub } from '../model/pub';
import type { Color, Dash, Fill, Footnote, Item, Line, ParaProps, ParaStyle, Paragraph, Publication, RunProps, Story, TableItem } from '../model/types';
import { cmykToHex, colorHex, fontsUsed, paraOverrides, resolvePara, resolveRun, runOverrides } from '../model/styles';
import { esc, XML_DECL } from './xml';

export const IDML_NS = 'http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging';
export const DOM_VERSION = '16.0';
export const NO_CHAR_STYLE = 'CharacterStyle/$ID/[No character style]';
export const NORMAL_PARA_STYLE = 'ParagraphStyle/$ID/NormalParagraphStyle';
export const NO_PARA_STYLE = 'ParagraphStyle/$ID/[No paragraph style]';

/** Opening tag of a package part. */
export const pkgOpen = (name: string) => `${XML_DECL}<idPkg:${name} xmlns:idPkg="${IDML_NS}" DOMVersion="${DOM_VERSION}">\n`;
export const pkgClose = (name: string) => `</idPkg:${name}>\n`;

/** Numbers as IDML writes them: up to three decimals, no trailing zeros. */
export const n = (v: number): string => { const r = Math.round((Number.isFinite(v) ? v : 0) * 1000) / 1000; return Object.is(r, -0) ? '0' : String(r); };

/** Self ids of named resources: ':' and '/' are percent-encoded the way InDesign does it. */
export const encName = (name: string): string => name.replace(/%/g, '%25').replace(/:/g, '%3a').replace(/\//g, '%2f');

export interface ColorDef { self: string; name: string; space: 'CMYK' | 'RGB'; values: number[]; spot?: boolean }
export interface GradientDef { self: string; name: string; radial: boolean; stops: { color: string; location: number }[] }
export interface HyperlinkDef { self: string; source: string; name: string; url: string }

export interface ExportCtx {
  pub: Pub;
  P: Publication;
  nextId(): string;
  /** Color entries for Graphic.xml, by Self (built-ins and swatches first, hex colors as used). */
  colors: Map<string, ColorDef>;
  gradients: GradientDef[];
  /** A "Dash Dot" stroke style is needed in Graphic.xml. */
  dashDot: boolean;
  storyFiles: { self: string; file: string; xml: string }[];
  hyperlinks: HyperlinkDef[];
  /** Items anchored in text that a story has placed (so the spreads leave them out). */
  anchoredWritten: Set<string>;
  /** The anchored item for a run's anchor id, if any. */
  anchoredItem(id: string): Item | undefined;
  /** XML of an item nested inside a character style range (set by the package writer). */
  anchoredXml(item: Item): string;
  /** Stories written: Self per model story id. */
  storySelf: Map<string, string>;
}

// ------------------------------------------------------------------------------------------
// Colors

/** Registers the publication's swatches (Black and Paper are built in; None is Swatch/None). */
export function registerSwatches(ctx: ExportCtx): void {
  ctx.colors.set('Color/Black', { self: 'Color/Black', name: 'Black', space: 'CMYK', values: [0, 0, 0, 100] });
  ctx.colors.set('Color/Paper', { self: 'Color/Paper', name: 'Paper', space: 'CMYK', values: [0, 0, 0, 0] });
  for (const sw of ctx.P.swatches) {
    if (['None', 'Black', 'White'].includes(sw.name) || sw.color === 'none') continue;
    const self = `Color/${encName(sw.name)}`;
    const hex = colorHex(ctx.P, sw.color, '#000000');
    // CMYK when the swatch's CMYK values and its screen color agree (a process color the user defined);
    // otherwise RGB, so the color the publication shows survives the round trip.
    if (sw.cmyk && cmykToHex(sw.cmyk[0], sw.cmyk[1], sw.cmyk[2], sw.cmyk[3]).toUpperCase() === hex.toUpperCase()) ctx.colors.set(self, { self, name: sw.name, space: 'CMYK', values: sw.cmyk.map((v) => Math.max(0, Math.min(100, v))), spot: sw.spot });
    else { const rgb = hexRgb(hex); if (rgb) ctx.colors.set(self, { self, name: sw.name, space: 'RGB', values: rgb, spot: sw.spot }); }
  }
}

function hexRgb(hex: string): number[] | null {
  const m = /^#([0-9a-f]{3,8})$/i.exec(hex);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('');
  if (h.length < 6) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** FillColor/StrokeColor reference for a model color (a swatch name or a hex value). */
export function colorRef(ctx: ExportCtx, c: Color | undefined): string {
  if (!c || c === 'none') return 'Swatch/None';
  if (c === 'Black') return 'Color/Black';
  if (c === 'White' || c === 'Paper') return 'Color/Paper';
  const sw = ctx.P.swatches.find((s) => s.name === c);
  if (sw) {
    if (sw.color === 'none') return 'Swatch/None';
    const self = `Color/${encName(sw.name)}`;
    if (ctx.colors.has(self)) return self;
  }
  const rgb = hexRgb(colorHex(ctx.P, c, ''));
  if (!rgb) return 'Color/Black';
  const name = `R=${rgb[0]} G=${rgb[1]} B=${rgb[2]}`;
  const self = `Color/${name}`;
  if (!ctx.colors.has(self)) ctx.colors.set(self, { self, name, space: 'RGB', values: rgb });
  return self;
}

/** Fill reference: a color, a gradient (registered for Graphic.xml) or none. */
export function fillRef(ctx: ExportCtx, f: Fill | undefined): { ref: string; tint?: number } {
  if (!f || f.type === 'none' || f.type === 'image') return { ref: 'Swatch/None' };
  if (f.type === 'solid') return { ref: colorRef(ctx, f.color), ...(f.alpha != null && f.alpha < 1 ? { tint: Math.round(f.alpha * 100) } : {}) };
  if (f.type === 'pattern') return { ref: colorRef(ctx, f.fg) };
  const self = `Gradient/${ctx.nextId()}`;
  ctx.gradients.push({ self, name: `Gradient ${ctx.gradients.length + 1}`, radial: f.path === 'radial', stops: f.stops.map((s) => ({ color: colorRef(ctx, s.color), location: Math.max(0, Math.min(100, s.pos * 100)) })) });
  return { ref: self };
}

const STROKE_STYLE: Record<Dash, string> = { solid: 'StrokeStyle/$ID/Solid', dash: 'StrokeStyle/$ID/Dashed (3 and 2)', sysDash: 'StrokeStyle/$ID/Dashed (3 and 2)', longDash: 'StrokeStyle/$ID/Dashed (4 and 4)', longDashDot: 'StrokeStyle/$ID/Dashed (4 and 4)', dot: 'StrokeStyle/$ID/Dotted', sysDot: 'StrokeStyle/$ID/Dotted', dashDot: 'StrokeStyle/Dash Dot' };
const LINE_END: Record<string, string> = { triangle: 'TriangleArrowHead', arrow: 'SimpleArrowHead', stealth: 'BarbedArrowHead', diamond: 'SquareArrowHead', oval: 'CircleArrowHead' };

/** Fill and stroke attributes of an item or object style. */
export function fillStrokeAttrs(ctx: ExportCtx, fill: Fill | undefined, line: Line | undefined, ends = false): string {
  const f = fillRef(ctx, fill);
  let s = ` FillColor="${esc(f.ref)}"`;
  if (f.tint != null) s += ` FillTint="${f.tint}"`;
  const width = line?.width ?? 0;
  const lf = line?.fill;
  const stroke = width > 0 && lf && lf.type !== 'none' ? (lf.type === 'solid' ? colorRef(ctx, lf.color) : lf.type === 'gradient' ? colorRef(ctx, lf.stops[0]?.color) : lf.type === 'pattern' ? colorRef(ctx, lf.fg) : 'Swatch/None') : 'Swatch/None';
  s += ` StrokeColor="${esc(stroke)}" StrokeWeight="${n(stroke === 'Swatch/None' ? 0 : width)}"`;
  if (line?.dash && line.dash !== 'solid') { s += ` StrokeType="${esc(STROKE_STYLE[line.dash] || STROKE_STYLE.dash)}"`; if (line.dash === 'dashDot') ctx.dashDot = true; }
  if (line?.cap) s += ` EndCap="${line.cap === 'round' ? 'RoundEndCap' : line.cap === 'square' ? 'ProjectingEndCap' : 'ButtEndCap'}"`;
  if (line?.join) s += ` EndJoin="${line.join === 'round' ? 'RoundEndJoin' : line.join === 'bevel' ? 'BevelEndJoin' : 'MiterEndJoin'}"`;
  if (ends) {
    if (line?.head && line.head !== 'none') s += ` RightLineEnd="${LINE_END[line.head] || 'SimpleArrowHead'}"`;
    if (line?.tail && line.tail !== 'none') s += ` LeftLineEnd="${LINE_END[line.tail] || 'SimpleArrowHead'}"`;
  }
  return s;
}

/** Resources/Graphic.xml. */
export function graphicXml(ctx: ExportCtx): string {
  const out: string[] = [pkgOpen('Graphic')];
  for (const c of ctx.colors.values()) {
    out.push(`<Color Self="${esc(c.self)}" Model="${c.spot ? 'Spot' : 'Process'}" Space="${c.space}" ColorValue="${c.values.map(n).join(' ')}" ColorOverride="Normal" AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="${esc(c.name)}" ColorEditable="${c.self === 'Color/Black' || c.self === 'Color/Paper' ? 'false' : 'true'}" ColorRemovable="${c.self === 'Color/Black' || c.self === 'Color/Paper' ? 'false' : 'true'}" Visible="true" SwatchCreatorID="7937"/>\n`);
  }
  out.push('<Swatch Self="Swatch/None" Name="None" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>\n');
  out.push('<StrokeStyle Self="StrokeStyle/$ID/Solid" Name="$ID/Solid"/>\n');
  if (ctx.dashDot) out.push('<DashedStrokeStyle Self="StrokeStyle/Dash Dot" Name="Dash Dot" DashCornerAdjustment="Adjust"><Properties><DashArray type="list"><ListItem type="unit">6</ListItem><ListItem type="unit">3</ListItem><ListItem type="unit">1</ListItem><ListItem type="unit">3</ListItem></DashArray></Properties></DashedStrokeStyle>\n');
  for (const g of ctx.gradients) {
    out.push(`<Gradient Self="${esc(g.self)}" Type="${g.radial ? 'Radial' : 'Linear'}" Name="${esc(g.name)}" ColorEditable="true" ColorRemovable="true" Visible="true" SwatchCreatorID="7937">`);
    g.stops.forEach((s, i) => out.push(`<GradientStop Self="${esc(g.self)}GradientStop${i}" StopColor="${esc(s.color)}" Location="${n(s.location)}"/>`));
    out.push('</Gradient>\n');
  }
  out.push(pkgClose('Graphic'));
  return out.join('');
}

// ------------------------------------------------------------------------------------------
// Styles

const JUSTIFY: Record<NonNullable<ParaProps['align']>, string> = { l: 'LeftAlign', ctr: 'CenterAlign', r: 'RightAlign', just: 'LeftJustified', justAll: 'FullyJustified' };

export function paraSelf(ctx: ExportCtx, name: string | undefined): string {
  if (!name) return NORMAL_PARA_STYLE;
  return ctx.P.styles.para.some((s) => s.name === name) ? `ParagraphStyle/${encName(name)}` : NORMAL_PARA_STYLE;
}

export function charSelf(ctx: ExportCtx, name: string | undefined): string {
  if (!name) return NO_CHAR_STYLE;
  return ctx.P.styles.char.some((s) => s.name === name) ? `CharacterStyle/${encName(name)}` : NO_CHAR_STYLE;
}

export function objectSelf(ctx: ExportCtx, name: string | undefined, kind: 'text' | 'graphic' | 'none' = 'none'): string {
  if (name && ctx.P.styles.object.some((s) => s.name === name)) return `ObjectStyle/${encName(name)}`;
  return kind === 'text' ? 'ObjectStyle/$ID/[Normal Text Frame]' : kind === 'graphic' ? 'ObjectStyle/$ID/[Normal Graphics Frame]' : 'ObjectStyle/$ID/[None]';
}

/** Character attributes (and Properties children) of run properties; `size` is the size in effect for tracking. */
export function runAttrs(ctx: ExportCtx, r: RunProps, size: number): { attrs: string; props: string } {
  let a = '', p = '';
  if (r.b !== undefined || r.i !== undefined) a += ` FontStyle="${r.b && r.i ? 'Bold Italic' : r.b ? 'Bold' : r.i ? 'Italic' : 'Regular'}"`;
  if (r.size) a += ` PointSize="${n(r.size)}"`;
  if (r.outline) {
    // IDML has no outline style: paper-filled glyphs stroked in the text colour give the same look.
    a += ` FillColor="Color/Paper" StrokeColor="${esc(colorRef(ctx, r.color || 'Black'))}" StrokeWeight="${n((r.size || size || 10) / 30)}"`;
  } else if (r.color) a += ` FillColor="${esc(colorRef(ctx, r.color))}"`;
  if (r.u !== undefined) a += ` Underline="${r.u ? 'true' : 'false'}"`;
  if (r.strike !== undefined) a += ` StrikeThru="${r.strike ? 'true' : 'false'}"`;
  if (r.caps) a += ` Capitalization="${r.caps === 'all' ? 'AllCaps' : r.caps === 'small' ? 'SmallCaps' : 'Normal'}"`;
  if (r.baseline !== undefined) a += ` Position="${r.baseline > 0 ? 'Superscript' : r.baseline < 0 ? 'Subscript' : 'Normal'}"`;
  if (r.spc) a += ` Tracking="${n((r.spc * 1000) / (r.size || size || 10))}"`;
  if (r.hscale !== undefined && r.hscale !== 100) a += ` HorizontalScale="${n(r.hscale)}"`;
  if (r.shift) a += ` BaselineShift="${n(r.shift)}"`;
  if (r.liga !== undefined) a += ` Ligatures="${r.liga ? 'true' : 'false'}"`;
  if (r.kern !== undefined) a += ` KerningMethod="${r.kern ? '$ID/Metrics' : '$ID/None'}"`;
  if (r.font) p += `<AppliedFont type="string">${esc(r.font)}</AppliedFont>`;
  return { attrs: a, props: p };
}

/** Paragraph attributes (and Properties children); `size` is the size in effect for percent leading. */
export function paraAttrs(ctx: ExportCtx, p: ParaProps, size: number): { attrs: string; props: string } {
  let a = '', pr = '';
  if (p.align) a += ` Justification="${JUSTIFY[p.align] || 'LeftAlign'}"`;
  if (p.marL !== undefined) a += ` LeftIndent="${n(p.marL)}"`;
  if (p.marR !== undefined) a += ` RightIndent="${n(p.marR)}"`;
  if (p.indent !== undefined) a += ` FirstLineIndent="${n(p.indent)}"`;
  if (p.spaceBefore !== undefined) a += ` SpaceBefore="${n(p.spaceBefore)}"`;
  if (p.spaceAfter !== undefined) a += ` SpaceAfter="${n(p.spaceAfter)}"`;
  if (p.hyphenate !== undefined) a += ` Hyphenation="${p.hyphenate ? 'true' : 'false'}"`;
  if (p.dropCap && p.dropCap.lines > 1) a += ` DropCapLines="${p.dropCap.lines}" DropCapCharacters="${p.dropCap.chars || 1}"`;
  if (p.keepWithNext !== undefined) a += ` KeepWithNext="${p.keepWithNext ? 1 : 0}"`;
  if (p.keepLines !== undefined) a += ` KeepLinesTogether="${p.keepLines ? 'true' : 'false'}"`;
  if (p.gridAlign !== undefined) a += ` AlignToBaseline="${p.gridAlign ? 'true' : 'false'}"`;
  if (p.bullet) a += ` BulletsAndNumberingListType="${p.bullet.kind === 'char' ? 'BulletList' : p.bullet.kind === 'num' ? 'NumberedList' : 'NoList'}"`;
  if (p.ruleAbove) a += ` RuleAbove="true" RuleAboveLineWeight="${n(p.ruleAbove.width)}" RuleAboveColor="${esc(colorRef(ctx, p.ruleAbove.color))}" RuleAboveOffset="${n(p.ruleAbove.offset || 0)}"`;
  if (p.ruleBelow) a += ` RuleBelow="true" RuleBelowLineWeight="${n(p.ruleBelow.width)}" RuleBelowColor="${esc(colorRef(ctx, p.ruleBelow.color))}" RuleBelowOffset="${n(p.ruleBelow.offset || 0)}"`;
  if (p.lineSpacing) {
    if (p.lineSpacingPt) pr += `<Leading type="unit">${n(p.lineSpacing)}</Leading>`;
    else { a += ` AutoLeading="${n(p.lineSpacing)}"`; pr += `<Leading type="unit">${n((size * p.lineSpacing) / 100)}</Leading>`; }
  }
  if (p.tabs && p.tabs.length) {
    pr += '<TabList type="list">' + p.tabs.map((t) => `<ListItem type="record"><Alignment type="enumeration">${t.align === 'ctr' ? 'CenterAlign' : t.align === 'r' ? 'RightAlign' : t.align === 'dec' ? 'CharacterAlign' : 'LeftAlign'}</Alignment><AlignmentCharacter type="string">.</AlignmentCharacter><Leader type="string">${esc(t.leader || '')}</Leader><Position type="unit">${n(t.pos)}</Position></ListItem>`).join('') + '</TabList>';
  }
  return { attrs: a, props: pr };
}

const propsEl = (inner: string) => (inner ? `<Properties>${inner}</Properties>` : '');

function paraStyleXml(ctx: ExportCtx, st: ParaStyle, self: string, name: string): string {
  const size = resolvePara(ctx.P, { style: st.name }).run.size || 10.5;
  const pa = paraAttrs(ctx, paraOverrides(st), size);
  const ra = st.run ? runAttrs(ctx, runOverrides(st.run), size) : { attrs: '', props: '' };
  let props = '';
  if (st.basedOn && st.basedOn !== st.name && ctx.P.styles.para.some((s) => s.name === st.basedOn)) props += `<BasedOn type="object">${esc(paraSelf(ctx, st.basedOn))}</BasedOn>`;
  if (st.next && ctx.P.styles.para.some((s) => s.name === st.next)) props += `<NextStyle type="object">${esc(paraSelf(ctx, st.next))}</NextStyle>`;
  props += ra.props + pa.props;
  return `<ParagraphStyle Self="${esc(self)}" Name="${esc(name)}" Imported="false"${pa.attrs}${ra.attrs}>${propsEl(props)}</ParagraphStyle>\n`;
}

/** Resources/Styles.xml. */
export function stylesXml(ctx: ExportCtx): string {
  const out: string[] = [pkgOpen('Styles')];
  out.push(`<RootCharacterStyleGroup Self="${ctx.nextId()}">\n<CharacterStyle Self="${esc(NO_CHAR_STYLE)}" Name="$ID/[No character style]"/>\n`);
  for (const cs of ctx.P.styles.char) {
    const ra = runAttrs(ctx, runOverrides(cs), cs.size || 10.5);
    let props = ra.props;
    if (cs.basedOn && cs.basedOn !== cs.name && ctx.P.styles.char.some((s) => s.name === cs.basedOn)) props = `<BasedOn type="object">${esc(charSelf(ctx, cs.basedOn))}</BasedOn>` + props;
    out.push(`<CharacterStyle Self="${esc(charSelf(ctx, cs.name))}" Name="${esc(cs.name)}" Imported="false"${ra.attrs}>${propsEl(props)}</CharacterStyle>\n`);
  }
  out.push('</RootCharacterStyleGroup>\n');
  out.push(`<RootParagraphStyleGroup Self="${ctx.nextId()}">\n<ParagraphStyle Self="${esc(NO_PARA_STYLE)}" Name="$ID/[No paragraph style]"/>\n`);
  const body = ctx.P.styles.para.find((s) => s.name === 'Body') || ctx.P.styles.para[0];
  if (body) out.push(paraStyleXml(ctx, { ...body, basedOn: undefined, next: undefined }, NORMAL_PARA_STYLE, '$ID/NormalParagraphStyle'));
  for (const st of ctx.P.styles.para) out.push(paraStyleXml(ctx, st, paraSelf(ctx, st.name), st.name));
  out.push('</RootParagraphStyleGroup>\n');
  out.push(`<RootObjectStyleGroup Self="${ctx.nextId()}">\n<ObjectStyle Self="ObjectStyle/$ID/[None]" Name="$ID/[None]"/>\n<ObjectStyle Self="ObjectStyle/$ID/[Normal Graphics Frame]" Name="$ID/[Normal Graphics Frame]"/>\n<ObjectStyle Self="ObjectStyle/$ID/[Normal Text Frame]" Name="$ID/[Normal Text Frame]"/>\n`);
  for (const os of ctx.P.styles.object) {
    const ins = os.insets;
    out.push(`<ObjectStyle Self="${esc(objectSelf(ctx, os.name))}" Name="${esc(os.name)}"${fillStrokeAttrs(ctx, os.fill, os.line)}>${ins || os.columns ? `<TextFramePreference${os.columns ? ` TextColumnCount="${os.columns}"` : ''}${os.gutter != null ? ` TextColumnGutter="${n(os.gutter)}"` : ''}>${ins ? `<Properties><InsetSpacing type="list"><ListItem type="unit">${n(ins[1])}</ListItem><ListItem type="unit">${n(ins[0])}</ListItem><ListItem type="unit">${n(ins[3])}</ListItem><ListItem type="unit">${n(ins[2])}</ListItem></InsetSpacing></Properties>` : ''}</TextFramePreference>` : ''}</ObjectStyle>\n`);
  }
  out.push('</RootObjectStyleGroup>\n');
  out.push(`<RootTableStyleGroup Self="${ctx.nextId()}"><TableStyle Self="TableStyle/$ID/[Basic Table]" Name="$ID/[Basic Table]"/></RootTableStyleGroup>\n`);
  out.push(`<RootCellStyleGroup Self="${ctx.nextId()}"><CellStyle Self="CellStyle/$ID/[None]" Name="$ID/[None]"/></RootCellStyleGroup>\n`);
  out.push(pkgClose('Styles'));
  return out.join('');
}

/** Resources/Fonts.xml: the families the publication uses, with the four common faces. */
export function fontsXml(ctx: ExportCtx): string {
  const out: string[] = [pkgOpen('Fonts')];
  const families = fontsUsed(ctx.P);
  if (!families.includes('Tinos')) families.push('Tinos');
  for (const fam of families) {
    const ps = fam.replace(/\s+/g, '');
    out.push(`<FontFamily Self="${ctx.nextId()}" Name="${esc(fam)}">`);
    for (const face of ['Regular', 'Bold', 'Italic', 'Bold Italic']) out.push(`<Font Self="${ctx.nextId()}" FontFamily="${esc(fam)}" Name="${esc(`${fam} ${face}`)}" PostScriptName="${esc(`${ps}-${face.replace(/\s+/g, '')}`)}" Status="Installed" FontStyleName="${face}" FontType="OpenTypeTT" WritingScript="0" FullName="${esc(`${fam} ${face}`)}" FullNameNative="${esc(`${fam} ${face}`)}" FontStyleNameNative="${face}" PlatformName="$ID/" Version="1.0" TypekitID="$ID/"/>`);
    out.push('</FontFamily>\n');
  }
  out.push(pkgClose('Fonts'));
  return out.join('');
}

// ------------------------------------------------------------------------------------------
// Stories

export interface StoryOpts { name?: string; footnotes?: Footnote[]; opticalMargin?: boolean }

const contentEl = (text: string) => `<Content>${esc(text).replace(/\u2028/g, '&#x2028;')}</Content>`;

/** One paragraph as a ParagraphStyleRange with its character style ranges. */
function paragraphXml(ctx: ExportCtx, p: Paragraph, last: boolean, footnotes: Footnote[] | undefined, inFootnote: boolean): string {
  const resolved = resolvePara(ctx.P, p);
  const size = resolved.run.size || 10.5;
  const pa = paraAttrs(ctx, paraOverrides(p), size);
  const out: string[] = [`<ParagraphStyleRange AppliedParagraphStyle="${esc(paraSelf(ctx, p.style))}"${pa.attrs}>${propsEl(pa.props)}`];
  for (const r of p.runs) {
    const over = runOverrides(r);
    const cstyle = over.cstyle;
    delete over.cstyle;
    delete (over as any).link;
    const eff = resolveRun(ctx.P, resolved.run, r);
    const ra = runAttrs(ctx, over, eff.size || size);
    const open = `<CharacterStyleRange AppliedCharacterStyle="${esc(charSelf(ctx, cstyle))}"${ra.attrs}>${propsEl(ra.props)}`;
    let inner = '';
    if (r.br) inner = contentEl('\u2028');
    else if (r.anchor) {
      const item = ctx.anchoredItem(r.anchor);
      if (item && !ctx.anchoredWritten.has(item.id)) { ctx.anchoredWritten.add(item.id); inner = ctx.anchoredXml(item); }
    } else if (r.footnote && !inFootnote) {
      const fn = footnotes?.find((f) => f.id === r.footnote);
      if (fn) {
        const paras = fn.paras.length ? fn.paras : [{ style: 'Footnote', runs: [] }];
        inner = `<Footnote Self="${ctx.nextId()}">` + paras.map((fp, i) => paragraphXml(ctx, fp, i === paras.length - 1, undefined, true)).join('') + '</Footnote>';
      } else if (r.text) inner = contentEl(r.text);
    } else if (r.text) {
      const content = contentEl(r.text);
      if (r.link) {
        const self = ctx.nextId();
        ctx.hyperlinks.push({ self, source: self, name: r.link, url: r.link });
        inner = `<HyperlinkTextSource Self="${self}" Name="${esc(r.link)}" Hidden="false" AppliedCharacterStyle="${esc(NO_CHAR_STYLE)}">${content}</HyperlinkTextSource>`;
      } else inner = content;
    }
    if (!inner && !r.br) continue;
    out.push(open + inner + '</CharacterStyleRange>');
  }
  if (!last) out.push(`<CharacterStyleRange AppliedCharacterStyle="${esc(NO_CHAR_STYLE)}"><Br/></CharacterStyleRange>`);
  out.push('</ParagraphStyleRange>\n');
  return out.join('');
}

/** The footnote marker (InDesign's special character 4) opens a footnote's first paragraph. */
function markerFix(xml: string): string {
  return xml.replace(/<Footnote Self="([^"]+)"><ParagraphStyleRange([^>]*)>(<Properties>.*?<\/Properties>)?/g, (_m, self, attrs, props) => `<Footnote Self="${self}"><ParagraphStyleRange${attrs}>${props || ''}<CharacterStyleRange AppliedCharacterStyle="${NO_CHAR_STYLE}"><Content><?ACE 4?></Content></CharacterStyleRange>`);
}

/** The element content of a story (ranges only), shared by stories and table cells. */
export function parasXml(ctx: ExportCtx, paras: Paragraph[], footnotes?: Footnote[]): string {
  const list = paras.length ? paras : [{ style: 'Body', runs: [] }];
  return markerFix(list.map((p, i) => paragraphXml(ctx, p, i === list.length - 1, footnotes, false)).join(''));
}

function storyOpen(ctx: ExportCtx, self: string, opts: StoryOpts): string {
  const optical = opts.opticalMargin ?? false;
  const size = (ctx.P as any).opticalMarginSize ?? 12;
  return `${pkgOpen('Story')}<Story Self="${self}" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="${esc(opts.name || '')}" AppliedNamedGrid="n">\n<StoryPreference OpticalMarginAlignment="${optical ? 'true' : 'false'}" OpticalMarginSize="${n(size)}" FrameType="TextFrameType" StoryOrientation="Horizontal" StoryDirection="LeftToRightDirection"/>\n<InCopyExportOption IncludeGraphicProxies="true" IncludeAllResources="false"/>\n`;
}

const storyClose = () => `</Story>\n${pkgClose('Story')}`;

/** Registers a story part and returns its Self. */
export function addStory(ctx: ExportCtx, paras: Paragraph[], opts: StoryOpts = {}, modelId?: string): string {
  const self = ctx.nextId();
  if (modelId) ctx.storySelf.set(modelId, self);
  const xml = storyOpen(ctx, self, opts) + parasXml(ctx, paras, opts.footnotes) + storyClose();
  ctx.storyFiles.push({ self, file: `Stories/Story_${self}.xml`, xml });
  return self;
}

/** Writes a model story (paragraphs, footnotes, name) and returns its Self. */
export function addModelStory(ctx: ExportCtx, s: Story): string {
  const existing = ctx.storySelf.get(s.id);
  if (existing) return existing;
  return addStory(ctx, s.paras, { name: s.name, footnotes: s.footnotes, opticalMargin: (s as any).opticalMargin }, s.id);
}

/** A table as a story holding one Table element (InDesign tables live in text). Returns the story Self. */
export function addTableStory(ctx: ExportCtx, t: TableItem): string {
  const self = ctx.nextId();
  const tableSelf = ctx.nextId();
  const rows = t.rows, cols = t.cols.length ? t.cols : [t.w];
  const header = rows.filter((r) => r.header).length;
  const footnotes: Footnote[] | undefined = (t as any).footnotes;
  const out: string[] = [storyOpen(ctx, self, { name: t.name })];
  out.push(`<ParagraphStyleRange AppliedParagraphStyle="${esc(paraSelf(ctx, 'Table Text'))}"><CharacterStyleRange AppliedCharacterStyle="${esc(NO_CHAR_STYLE)}">`);
  out.push(`<Table Self="${tableSelf}" HeaderRowCount="${header}" FooterRowCount="0" BodyRowCount="${Math.max(0, rows.length - header)}" ColumnCount="${cols.length}" AppliedTableStyle="TableStyle/$ID/[Basic Table]" TableDirection="LeftToRightDirection">`);
  rows.forEach((r, i) => out.push(`<Row Self="${tableSelf}Row${i}" Name="${i}" SingleRowHeight="${n(r.h)}"/>`));
  cols.forEach((w, i) => out.push(`<Column Self="${tableSelf}Column${i}" Name="${i}" SingleColumnWidth="${n(w)}"/>`));
  rows.forEach((r, ri) => r.cells.forEach((c, ci) => {
    if (c.merged || ci >= cols.length) return;
    const fill = c.fill ? fillRef(ctx, c.fill) : null;
    out.push(`<Cell Self="${tableSelf}i${ci}_${ri}" Name="${ci}:${ri}" RowSpan="${c.rowSpan || 1}" ColumnSpan="${c.colSpan || 1}" AppliedCellStyle="CellStyle/$ID/[None]"${fill ? ` FillColor="${esc(fill.ref)}"` : ''}${c.anchor === 'ctr' ? ' VerticalJustification="CenterAlign"' : c.anchor === 'b' ? ' VerticalJustification="BottomAlign"' : ''}>`);
    out.push(parasXml(ctx, c.text, footnotes));
    out.push('</Cell>');
  }));
  out.push('</Table></CharacterStyleRange></ParagraphStyleRange>\n');
  out.push(storyClose());
  ctx.storyFiles.push({ self, file: `Stories/Story_${self}.xml`, xml: out.join('') });
  return self;
}
