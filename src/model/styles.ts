/**
 * Style sheets: the default paragraph, character and object styles of a new publication, style
 * resolution (character style → paragraph style chain → defaults), and the color and font schemes.
 */
import type { Publication, ParaStyle, CharStyle, ObjectStyle, Paragraph, RunProps, Run, ParaProps, Swatch, Color } from './types';

export const DEFAULT_BODY_FONT = 'Tinos';
export const DEFAULT_HEAD_FONT = 'Arimo';

export function defaultStyles(): Publication['styles'] {
  const para: ParaStyle[] = [
    { name: 'Body', align: 'l', spaceAfter: 6, lineSpacing: 120, hyphenate: true, run: { font: DEFAULT_BODY_FONT, size: 10.5, color: 'Black' }, next: 'Body' },
    { name: 'Body No Indent', basedOn: 'Body', indent: 0, next: 'Body' },
    { name: 'Body First', basedOn: 'Body', indent: 0, next: 'Body' },
    { name: 'Heading 1', align: 'l', spaceBefore: 14, spaceAfter: 6, lineSpacing: 110, keepWithNext: true, run: { font: DEFAULT_HEAD_FONT, size: 24, b: true, color: 'Primary' }, next: 'Body' },
    { name: 'Heading 2', align: 'l', spaceBefore: 10, spaceAfter: 4, lineSpacing: 110, keepWithNext: true, run: { font: DEFAULT_HEAD_FONT, size: 16, b: true, color: 'Black' }, next: 'Body' },
    { name: 'Heading 3', align: 'l', spaceBefore: 8, spaceAfter: 3, lineSpacing: 115, keepWithNext: true, run: { font: DEFAULT_HEAD_FONT, size: 12, b: true, color: 'Black' }, next: 'Body' },
    { name: 'Headline', align: 'l', spaceAfter: 8, lineSpacing: 100, run: { font: DEFAULT_HEAD_FONT, size: 36, b: true, color: 'Black' }, next: 'Deck' },
    { name: 'Deck', align: 'l', spaceAfter: 8, lineSpacing: 115, run: { font: DEFAULT_HEAD_FONT, size: 14, color: 'Dark Gray' }, next: 'Byline' },
    { name: 'Byline', align: 'l', spaceAfter: 10, run: { font: DEFAULT_HEAD_FONT, size: 9, caps: 'all', spc: 0.5, color: 'Dark Gray' }, next: 'Body' },
    { name: 'Subhead', basedOn: 'Heading 3', spaceBefore: 6, run: { font: DEFAULT_HEAD_FONT, size: 11, b: true, color: 'Primary' }, next: 'Body' },
    { name: 'Caption', align: 'l', spaceBefore: 3, lineSpacing: 115, run: { font: DEFAULT_HEAD_FONT, size: 8, i: true, color: 'Dark Gray' }, next: 'Body' },
    { name: 'Pull Quote', align: 'ctr', spaceBefore: 8, spaceAfter: 8, lineSpacing: 120, run: { font: DEFAULT_BODY_FONT, size: 16, i: true, color: 'Primary' }, next: 'Body' },
    { name: 'Bullet List', basedOn: 'Body', marL: 14, indent: -10, spaceAfter: 3, bullet: { kind: 'char', char: '•' }, next: 'Bullet List' },
    { name: 'Numbered List', basedOn: 'Body', marL: 16, indent: -12, spaceAfter: 3, bullet: { kind: 'num', scheme: 'arabicPeriod' }, next: 'Numbered List' },
    { name: 'Table Text', align: 'l', lineSpacing: 115, run: { font: DEFAULT_HEAD_FONT, size: 9, color: 'Black' }, next: 'Table Text' },
    { name: 'Table Header', basedOn: 'Table Text', run: { font: DEFAULT_HEAD_FONT, size: 9, b: true, color: 'White' }, next: 'Table Text' },
    { name: 'Folio', align: 'ctr', run: { font: DEFAULT_HEAD_FONT, size: 8, color: 'Dark Gray' }, next: 'Folio' },
    { name: 'Contact', align: 'l', lineSpacing: 120, run: { font: DEFAULT_HEAD_FONT, size: 8, color: 'Black' }, next: 'Contact' },
    { name: 'Footnote', align: 'l', spaceAfter: 2, lineSpacing: 115, hyphenate: true, run: { font: DEFAULT_BODY_FONT, size: 8, color: 'Black' }, next: 'Footnote' },
  ];
  const char: CharStyle[] = [
    { name: 'Emphasis', i: true },
    { name: 'Strong', b: true },
    { name: 'Code', font: 'Cousine', size: 9 },
    { name: 'Small Caps', caps: 'small' },
    { name: 'Link', color: 'Primary', u: true },
    { name: 'Run-in Head', b: true, caps: 'small', spc: 0.3 },
    { name: 'Footnote Reference', baseline: 33 },
  ];
  const object: ObjectStyle[] = [
    { name: 'Basic Text Frame', fill: { type: 'none' }, line: {}, insets: [4, 4, 4, 4] },
    { name: 'Sidebar', fill: { type: 'solid', color: 'Light Gray' }, line: {}, insets: [10, 10, 10, 10] },
    { name: 'Basic Graphics Frame', fill: { type: 'none' }, line: {} },
    { name: 'Accent Box', fill: { type: 'solid', color: 'Primary' }, line: {}, insets: [10, 10, 10, 10] },
    { name: 'Rule', line: { fill: { type: 'solid', color: 'Primary' }, width: 1 } },
  ];
  return { para, char, object };
}

export function defaultSwatches(): Swatch[] {
  return [
    { name: 'None', color: 'none' }, { name: 'Black', color: '#000000', cmyk: [0, 0, 0, 100] }, { name: 'White', color: '#FFFFFF', cmyk: [0, 0, 0, 0] },
    { name: 'Dark Gray', color: '#4A4A4A', cmyk: [0, 0, 0, 80] }, { name: 'Gray', color: '#8A8A8A', cmyk: [0, 0, 0, 50] }, { name: 'Light Gray', color: '#EDEDED', cmyk: [0, 0, 0, 8] },
    { name: 'Primary', color: '#5B3C9E', cmyk: [68, 78, 0, 10] }, { name: 'Secondary', color: '#C2502A', cmyk: [0, 70, 85, 15] }, { name: 'Accent', color: '#1E7A46', cmyk: [80, 0, 70, 40] },
    { name: 'Cyan', color: '#00AEEF', cmyk: [100, 0, 0, 0] }, { name: 'Magenta', color: '#EC008C', cmyk: [0, 100, 0, 0] }, { name: 'Yellow', color: '#FFF200', cmyk: [0, 0, 100, 0] },
  ];
}

/** Named color schemes (original). Each maps the swatch names a template uses. */
export const COLOR_SCHEMES: { name: string; colors: Record<string, string> }[] = [
  { name: 'Violet', colors: { Primary: '#5B3C9E', Secondary: '#C2502A', Accent: '#1E7A46' } },
  { name: 'Ocean', colors: { Primary: '#0D5C8A', Secondary: '#0D7C86', Accent: '#F2A33A' } },
  { name: 'Forest', colors: { Primary: '#1E6B3A', Secondary: '#8A6D2F', Accent: '#C2502A' } },
  { name: 'Ember', colors: { Primary: '#B3261E', Secondary: '#F2A33A', Accent: '#2B2B2B' } },
  { name: 'Slate', colors: { Primary: '#2B3A4A', Secondary: '#6A7B8C', Accent: '#C9A227' } },
  { name: 'Rose', colors: { Primary: '#A6303B', Secondary: '#D98C9A', Accent: '#3B3B3B' } },
  { name: 'Mono', colors: { Primary: '#111111', Secondary: '#555555', Accent: '#999999' } },
  { name: 'Citrus', colors: { Primary: '#2A7F62', Secondary: '#F4B400', Accent: '#E8572A' } },
];

export const FONT_SCHEMES: { name: string; head: string; body: string }[] = [
  { name: 'Classic', head: 'Arimo', body: 'Tinos' },
  { name: 'Modern', head: 'Open Sans', body: 'Open Sans' },
  { name: 'Editorial', head: 'Libre Baskerville', body: 'EB Garamond' },
  { name: 'Friendly', head: 'Lato', body: 'Lato' },
  { name: 'Literary', head: 'Merriweather', body: 'Gelasio' },
  { name: 'Office', head: 'Carlito', body: 'Carlito' },
  { name: 'Typewriter', head: 'Courier Prime', body: 'Courier Prime' },
  { name: 'Contrast', head: 'Merriweather', body: 'Arimo' },
];

// ------------------------------------------------------------------------------------------
// Resolution

const PARA_KEYS: (keyof ParaProps)[] = ['align', 'marL', 'marR', 'indent', 'spaceBefore', 'spaceAfter', 'lineSpacing', 'lineSpacingPt', 'bullet', 'dropCap', 'keepWithNext', 'keepLines', 'hyphenate', 'gridAlign', 'tabs', 'ruleAbove', 'ruleBelow'];
const RUN_KEYS: (keyof RunProps)[] = ['b', 'i', 'u', 'strike', 'size', 'font', 'color', 'highlight', 'baseline', 'caps', 'spc', 'kern', 'liga', 'link', 'lang'];

export function paraOverrides(p: Paragraph | ParaProps): ParaProps {
  const o: any = {};
  for (const k of PARA_KEYS) if ((p as any)[k] !== undefined) o[k] = (p as any)[k];
  return o;
}

export function runOverrides(r: Run | RunProps): RunProps {
  const o: any = {};
  for (const k of RUN_KEYS) if ((r as any)[k] !== undefined) o[k] = (r as any)[k];
  if ((r as RunProps).cstyle) o.cstyle = (r as RunProps).cstyle;
  return o;
}

/** The paragraph style chain, root first. */
export function paraChain(pub: Publication, name: string | undefined): ParaStyle[] {
  const out: ParaStyle[] = [];
  const seen = new Set<string>();
  let cur = name;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const s = pub.styles.para.find((x) => x.name === cur);
    if (!s) break;
    out.unshift(s);
    cur = s.basedOn;
  }
  if (!out.length) { const body = pub.styles.para.find((x) => x.name === 'Body') || pub.styles.para[0]; if (body) out.push(body); }
  return out;
}

export interface ResolvedPara { props: ParaProps; run: RunProps }

/** Paragraph properties and base run properties in effect for a paragraph. */
export function resolvePara(pub: Publication, p: Paragraph | ParaProps): ResolvedPara {
  const props: ParaProps = {};
  let run: RunProps = { font: DEFAULT_BODY_FONT, size: 10.5, color: '#000000' };
  for (const s of paraChain(pub, p.style)) { Object.assign(props, paraOverrides(s)); if (s.run) run = { ...run, ...runOverrides(s.run) }; }
  Object.assign(props, paraOverrides(p));
  return { props, run };
}

/** Run properties in effect for a run inside a paragraph (char style, then overrides). */
export function resolveRun(pub: Publication, base: RunProps, r: Run | RunProps): RunProps {
  let out = { ...base };
  if (r.cstyle) {
    const seen = new Set<string>();
    const chain: CharStyle[] = [];
    let cur: string | undefined = r.cstyle;
    while (cur && !seen.has(cur)) { seen.add(cur); const s = pub.styles.char.find((x) => x.name === cur); if (!s) break; chain.unshift(s); cur = s.basedOn; }
    for (const s of chain) out = { ...out, ...runOverrides(s) };
  }
  const ov = runOverrides(r);
  delete (ov as any).cstyle;
  return { ...out, ...ov };
}

/** '#rrggbb' for a color value (a swatch name or a hex color). */
export function colorHex(pub: Publication, c: Color | undefined, fallback = '#000000'): string {
  if (!c) return fallback;
  if (c === 'none') return 'none';
  if (/^#[0-9a-f]{3,8}$/i.test(c)) return c;
  const sw = pub.swatches.find((s) => s.name === c);
  if (sw) return sw.color === 'none' ? 'none' : sw.color;
  if (/^(rgb|hsl)a?\(/.test(c) || /^[a-z]{3,20}$/i.test(c)) return c;
  return fallback;
}

/** Converts CMYK (0..100) to an approximate hex color. */
export function cmykToHex(c: number, m: number, y: number, k: number): string {
  const f = (v: number) => Math.round(255 * (1 - Math.min(1, v / 100)) * (1 - Math.min(1, k / 100)));
  return '#' + [f(c), f(m), f(y)].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function hexToCmyk(hex: string): [number, number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return [0, 0, 0, 100];
  const r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255;
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 100];
  return [Math.round(((1 - r - k) / (1 - k)) * 100), Math.round(((1 - g - k) / (1 - k)) * 100), Math.round(((1 - b - k) / (1 - k)) * 100), Math.round(k * 100)];
}

/** Applies a color scheme to the publication's swatches (only the named ones). */
export function applyColorScheme(pub: Publication, scheme: { name: string; colors: Record<string, string> }): void {
  for (const [name, color] of Object.entries(scheme.colors)) {
    const sw = pub.swatches.find((s) => s.name === name);
    if (sw) { sw.color = color; sw.cmyk = hexToCmyk(color); } else pub.swatches.push({ name, color, cmyk: hexToCmyk(color) });
  }
  pub.scheme = { ...(pub.scheme || {}), colors: scheme.name };
}

/** Applies a font scheme: heading styles get the head font, the rest the body font. */
export function applyFontScheme(pub: Publication, scheme: { name: string; head: string; body: string }): void {
  for (const s of pub.styles.para) {
    if (!s.run?.font) continue;
    s.run.font = /heading|headline|deck|byline|subhead|caption|table|folio|contact/i.test(s.name) ? scheme.head : scheme.body;
  }
  pub.scheme = { ...(pub.scheme || {}), fonts: scheme.name };
}

/** Adds the footnote styles to a publication that lacks them (files from before footnotes existed). */
export function ensureFootnoteStyles(pub: Publication): void {
  const d = defaultStyles();
  if (!pub.styles.para.some((s) => s.name === 'Footnote')) pub.styles.para.push(d.para.find((s) => s.name === 'Footnote')!);
  if (!pub.styles.char.some((s) => s.name === 'Footnote Reference')) pub.styles.char.push(d.char.find((s) => s.name === 'Footnote Reference')!);
}

/** Fonts used anywhere in the publication. */
export function fontsUsed(pub: Publication): string[] {
  const set = new Set<string>();
  for (const s of pub.styles.para) if (s.run?.font) set.add(s.run.font);
  for (const s of pub.styles.char) if (s.font) set.add(s.font);
  for (const st of pub.stories) for (const p of st.paras) for (const r of p.runs) if (r.font) set.add(r.font);
  const walk = (items: any[]) => { for (const e of items) { if (e.kind === 'table') for (const row of e.rows) for (const c of row.cells) for (const p of c.text) for (const r of p.runs) if (r.font) set.add(r.font); if (e.kind === 'group') walk(e.children); } };
  for (const p of pub.pages) walk(p.items);
  for (const m of pub.masters) walk(m.items);
  return [...set].sort();
}
