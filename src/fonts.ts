/**
 * Fonts: the bundled open fonts (latin subsets) with metric-compatible aliases for common proprietary
 * fonts, and the fonts people add from their own files (TrueType, OpenType, collections, WOFF, WOFF2),
 * kept on this device in the app's store and registered with the browser's FontFace API, or carried
 * inside a publication package for the session.
 */
import { kvGet, kvSet, kvDel, kvKeys } from './util/store';
import tinos_400_normal from '@fontsource/tinos/files/tinos-latin-400-normal.woff2?url';
import tinos_400_italic from '@fontsource/tinos/files/tinos-latin-400-italic.woff2?url';
import tinos_700_normal from '@fontsource/tinos/files/tinos-latin-700-normal.woff2?url';
import tinos_700_italic from '@fontsource/tinos/files/tinos-latin-700-italic.woff2?url';
import arimo_400_normal from '@fontsource/arimo/files/arimo-latin-400-normal.woff2?url';
import arimo_400_italic from '@fontsource/arimo/files/arimo-latin-400-italic.woff2?url';
import arimo_700_normal from '@fontsource/arimo/files/arimo-latin-700-normal.woff2?url';
import arimo_700_italic from '@fontsource/arimo/files/arimo-latin-700-italic.woff2?url';
import cousine_400_normal from '@fontsource/cousine/files/cousine-latin-400-normal.woff2?url';
import cousine_400_italic from '@fontsource/cousine/files/cousine-latin-400-italic.woff2?url';
import cousine_700_normal from '@fontsource/cousine/files/cousine-latin-700-normal.woff2?url';
import cousine_700_italic from '@fontsource/cousine/files/cousine-latin-700-italic.woff2?url';
import carlito_400_normal from '@fontsource/carlito/files/carlito-latin-400-normal.woff2?url';
import carlito_400_italic from '@fontsource/carlito/files/carlito-latin-400-italic.woff2?url';
import carlito_700_normal from '@fontsource/carlito/files/carlito-latin-700-normal.woff2?url';
import carlito_700_italic from '@fontsource/carlito/files/carlito-latin-700-italic.woff2?url';
import caladea_400_normal from '@fontsource/caladea/files/caladea-latin-400-normal.woff2?url';
import caladea_400_italic from '@fontsource/caladea/files/caladea-latin-400-italic.woff2?url';
import caladea_700_normal from '@fontsource/caladea/files/caladea-latin-700-normal.woff2?url';
import caladea_700_italic from '@fontsource/caladea/files/caladea-latin-700-italic.woff2?url';
import gelasio_400_normal from '@fontsource/gelasio/files/gelasio-latin-400-normal.woff2?url';
import gelasio_400_italic from '@fontsource/gelasio/files/gelasio-latin-400-italic.woff2?url';
import gelasio_700_normal from '@fontsource/gelasio/files/gelasio-latin-700-normal.woff2?url';
import gelasio_700_italic from '@fontsource/gelasio/files/gelasio-latin-700-italic.woff2?url';
import eb_garamond_400_normal from '@fontsource/eb-garamond/files/eb-garamond-latin-400-normal.woff2?url';
import eb_garamond_400_italic from '@fontsource/eb-garamond/files/eb-garamond-latin-400-italic.woff2?url';
import eb_garamond_700_normal from '@fontsource/eb-garamond/files/eb-garamond-latin-700-normal.woff2?url';
import eb_garamond_700_italic from '@fontsource/eb-garamond/files/eb-garamond-latin-700-italic.woff2?url';
import courier_prime_400_normal from '@fontsource/courier-prime/files/courier-prime-latin-400-normal.woff2?url';
import courier_prime_400_italic from '@fontsource/courier-prime/files/courier-prime-latin-400-italic.woff2?url';
import courier_prime_700_normal from '@fontsource/courier-prime/files/courier-prime-latin-700-normal.woff2?url';
import courier_prime_700_italic from '@fontsource/courier-prime/files/courier-prime-latin-700-italic.woff2?url';
import libre_baskerville_400_normal from '@fontsource/libre-baskerville/files/libre-baskerville-latin-400-normal.woff2?url';
import libre_baskerville_400_italic from '@fontsource/libre-baskerville/files/libre-baskerville-latin-400-italic.woff2?url';
import libre_baskerville_700_normal from '@fontsource/libre-baskerville/files/libre-baskerville-latin-700-normal.woff2?url';
import libre_baskerville_700_italic from '@fontsource/libre-baskerville/files/libre-baskerville-latin-700-italic.woff2?url';
import lato_400_normal from '@fontsource/lato/files/lato-latin-400-normal.woff2?url';
import lato_400_italic from '@fontsource/lato/files/lato-latin-400-italic.woff2?url';
import lato_700_normal from '@fontsource/lato/files/lato-latin-700-normal.woff2?url';
import lato_700_italic from '@fontsource/lato/files/lato-latin-700-italic.woff2?url';
import merriweather_400_normal from '@fontsource/merriweather/files/merriweather-latin-400-normal.woff2?url';
import merriweather_400_italic from '@fontsource/merriweather/files/merriweather-latin-400-italic.woff2?url';
import merriweather_700_normal from '@fontsource/merriweather/files/merriweather-latin-700-normal.woff2?url';
import merriweather_700_italic from '@fontsource/merriweather/files/merriweather-latin-700-italic.woff2?url';
import open_sans_400_normal from '@fontsource/open-sans/files/open-sans-latin-400-normal.woff2?url';
import open_sans_400_italic from '@fontsource/open-sans/files/open-sans-latin-400-italic.woff2?url';
import open_sans_700_normal from '@fontsource/open-sans/files/open-sans-latin-700-normal.woff2?url';
import open_sans_700_italic from '@fontsource/open-sans/files/open-sans-latin-700-italic.woff2?url';

export const FACES: [string, string[], string, string, string][] = [
  ['Tinos', ['Times New Roman', 'Times', 'Liberation Serif'], '400', 'normal', tinos_400_normal],
  ['Tinos', ['Times New Roman', 'Times', 'Liberation Serif'], '400', 'italic', tinos_400_italic],
  ['Tinos', ['Times New Roman', 'Times', 'Liberation Serif'], '700', 'normal', tinos_700_normal],
  ['Tinos', ['Times New Roman', 'Times', 'Liberation Serif'], '700', 'italic', tinos_700_italic],
  ['Arimo', ['Arial', 'Helvetica', 'Liberation Sans'], '400', 'normal', arimo_400_normal],
  ['Arimo', ['Arial', 'Helvetica', 'Liberation Sans'], '400', 'italic', arimo_400_italic],
  ['Arimo', ['Arial', 'Helvetica', 'Liberation Sans'], '700', 'normal', arimo_700_normal],
  ['Arimo', ['Arial', 'Helvetica', 'Liberation Sans'], '700', 'italic', arimo_700_italic],
  ['Cousine', ['Courier New', 'Courier', 'Liberation Mono'], '400', 'normal', cousine_400_normal],
  ['Cousine', ['Courier New', 'Courier', 'Liberation Mono'], '400', 'italic', cousine_400_italic],
  ['Cousine', ['Courier New', 'Courier', 'Liberation Mono'], '700', 'normal', cousine_700_normal],
  ['Cousine', ['Courier New', 'Courier', 'Liberation Mono'], '700', 'italic', cousine_700_italic],
  ['Carlito', ['Calibri'], '400', 'normal', carlito_400_normal],
  ['Carlito', ['Calibri'], '400', 'italic', carlito_400_italic],
  ['Carlito', ['Calibri'], '700', 'normal', carlito_700_normal],
  ['Carlito', ['Calibri'], '700', 'italic', carlito_700_italic],
  ['Caladea', ['Cambria'], '400', 'normal', caladea_400_normal],
  ['Caladea', ['Cambria'], '400', 'italic', caladea_400_italic],
  ['Caladea', ['Cambria'], '700', 'normal', caladea_700_normal],
  ['Caladea', ['Cambria'], '700', 'italic', caladea_700_italic],
  ['Gelasio', ['Georgia'], '400', 'normal', gelasio_400_normal],
  ['Gelasio', ['Georgia'], '400', 'italic', gelasio_400_italic],
  ['Gelasio', ['Georgia'], '700', 'normal', gelasio_700_normal],
  ['Gelasio', ['Georgia'], '700', 'italic', gelasio_700_italic],
  ['EB Garamond', ['Garamond', 'Adobe Garamond Pro'], '400', 'normal', eb_garamond_400_normal],
  ['EB Garamond', ['Garamond', 'Adobe Garamond Pro'], '400', 'italic', eb_garamond_400_italic],
  ['EB Garamond', ['Garamond', 'Adobe Garamond Pro'], '700', 'normal', eb_garamond_700_normal],
  ['EB Garamond', ['Garamond', 'Adobe Garamond Pro'], '700', 'italic', eb_garamond_700_italic],
  ['Courier Prime', [], '400', 'normal', courier_prime_400_normal],
  ['Courier Prime', [], '400', 'italic', courier_prime_400_italic],
  ['Courier Prime', [], '700', 'normal', courier_prime_700_normal],
  ['Courier Prime', [], '700', 'italic', courier_prime_700_italic],
  ['Libre Baskerville', ['Baskerville', 'Baskerville Old Face'], '400', 'normal', libre_baskerville_400_normal],
  ['Libre Baskerville', ['Baskerville', 'Baskerville Old Face'], '400', 'italic', libre_baskerville_400_italic],
  ['Libre Baskerville', ['Baskerville', 'Baskerville Old Face'], '700', 'normal', libre_baskerville_700_normal],
  ['Libre Baskerville', ['Baskerville', 'Baskerville Old Face'], '700', 'italic', libre_baskerville_700_italic],
  ['Lato', [], '400', 'normal', lato_400_normal],
  ['Lato', [], '400', 'italic', lato_400_italic],
  ['Lato', [], '700', 'normal', lato_700_normal],
  ['Lato', [], '700', 'italic', lato_700_italic],
  ['Merriweather', [], '400', 'normal', merriweather_400_normal],
  ['Merriweather', [], '400', 'italic', merriweather_400_italic],
  ['Merriweather', [], '700', 'normal', merriweather_700_normal],
  ['Merriweather', [], '700', 'italic', merriweather_700_italic],
  ['Open Sans', [], '400', 'normal', open_sans_400_normal],
  ['Open Sans', [], '400', 'italic', open_sans_400_italic],
  ['Open Sans', [], '700', 'normal', open_sans_700_normal],
  ['Open Sans', [], '700', 'italic', open_sans_700_italic],
];

export function installFonts(): void {
  void installUserFonts();
  const css: string[] = [];
  for (const [fam, aliases, weight, style, url] of FACES) {
    css.push(`@font-face{font-family:"${fam}";src:url(${url}) format("woff2");font-weight:${weight};font-style:${style};font-display:swap}`);
    // Aliases prefer a locally installed original, falling back to the metric-compatible open font.
    for (const a of aliases) css.push(`@font-face{font-family:"${a}";src:local("${a}"),url(${url}) format("woff2");font-weight:${weight};font-style:${style};font-display:swap}`);
  }
  const el = document.createElement('style');
  el.id = 'ql-fonts';
  el.textContent = css.join('\n');
  document.head.appendChild(el);
}

/** Font names offered in the Font box (bundled fonts, their aliases, and common system fonts). */
export const FONT_LIST: string[] = [
  'Aptos', 'Arial', 'Arial Black', 'Arimo', 'Baskerville', 'Bookman Old Style', 'Calibri', 'Calibri Light', 'Cambria', 'Caladea', 'Candara', 'Carlito', 'Century Gothic',
  'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Courier Prime', 'Cousine', 'EB Garamond', 'Franklin Gothic Medium', 'Garamond', 'Gelasio',
  'Georgia', 'Helvetica', 'Impact', 'Lato', 'Libre Baskerville', 'Lucida Console', 'Lucida Sans Unicode', 'Merriweather', 'Open Sans', 'Palatino Linotype',
  'Segoe UI', 'Tahoma', 'Times New Roman', 'Tinos', 'Trebuchet MS', 'Verdana',
];

const quoteFam = (f: string) => `"${f.replace(/["\\]/g, '')}"`;

/** CSS font-family list for a cell font, with a sensible generic fallback. */
export function fontFamilyCss(name: string): string {
  const n = name || 'Carlito';
  const serif = /times|tinos|cambria|caladea|georgia|gelasio|garamond|baskerville|merriweather|bookman|palatino|constantia/i.test(n);
  const mono = /courier|cousine|consolas|lucida console|mono/i.test(n);
  // Aptos (the newer default UI font) is approximated by Carlito when not installed.
  const alias = /^aptos/i.test(n) ? ', "Carlito"' : '';
  return `${quoteFam(n)}${alias}, ${mono ? '"Cousine", monospace' : serif ? '"Tinos", serif' : '"Carlito", "Arimo", sans-serif'}`;
}

/** Calls fn once web fonts finish loading (canvas text needs a repaint). */
export function onFontsReady(fn: () => void): void {
  try {
    (document as any).fonts?.ready?.then(fn);
    (document as any).fonts?.addEventListener?.('loadingdone', fn);
  } catch { /* */ }
}

// ------------------------------------------------------------------------------------------
// User-supplied fonts

export type UserFontFormat = 'ttf' | 'otf' | 'ttc' | 'woff' | 'woff2';

export interface UserFont {
  id: string;
  family: string;
  subfamily: string;
  psName: string;
  weight: number;
  style: 'normal' | 'italic';
  format: UserFontFormat;
  /** The file it came from. */
  file: string;
  size: number;
  /** OS/2 fsType; embeddable is false for "Restricted License" fonts and for WOFF2 (no converter). */
  fsType: number;
  embeddable: boolean;
  /** CFF-based OpenType ("OTTO"): embedded whole in PDF rather than subset. */
  cff?: boolean;
  /** Came with a publication package: registered for this session only until installed. */
  packaged?: boolean;
  added: number;
}

const userFontMap = new Map<string, UserFont>();
const userFontData = new Map<string, Uint8Array>();
const faceObjects = new Map<string, any>();
const listeners = new Set<() => void>();
let packageFontsFlag = true;
let installed: Promise<void> | null = null;

const notify = () => { for (const l of listeners) { try { l(); } catch { /* */ } } };

/** Called when fonts are added, removed or installed. */
export function onUserFontsChange(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }

/** The user's fonts, sorted by family then weight. */
export function userFonts(): UserFont[] {
  return [...userFontMap.values()].sort((a, b) => a.family.localeCompare(b.family) || a.weight - b.weight || a.style.localeCompare(b.style));
}

export function userFont(id: string): UserFont | undefined { return userFontMap.get(id); }
export function userFontBytes(id: string): Uint8Array | undefined { return userFontData.get(id); }

/** Whether a family name (case-insensitive) is one of the user's fonts. */
export function isUserFamily(name: string | undefined): boolean {
  if (!name) return false;
  const n = name.trim().toLowerCase();
  for (const f of userFontMap.values()) if (f.family.toLowerCase() === n) return true;
  return false;
}

/** The user's faces of a family, closest weight and matching style first. */
export function userFaces(family: string | undefined): UserFont[] {
  if (!family) return [];
  const n = family.trim().toLowerCase();
  return userFonts().filter((f) => f.family.toLowerCase() === n);
}

/** Every family the Font box offers: bundled fonts, their aliases, common system fonts and the user's fonts. */
export function allFontFamilies(): string[] {
  const set = new Set<string>(FONT_LIST);
  for (const f of userFontMap.values()) set.add(f.family);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** The user's font families only. */
export function userFontFamilies(): string[] {
  return [...new Set([...userFontMap.values()].map((f) => f.family))].sort((a, b) => a.localeCompare(b));
}

/** Whether fonts used by a publication are written into its .qpp package (Fonts dialog option). */
export function packageFontsEnabled(): boolean { return packageFontsFlag; }
export function setPackageFonts(on: boolean): void { packageFontsFlag = on; }

function registerFace(f: UserFont, bytes: Uint8Array): void {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !(document as any).fonts) return;
  try {
    const key = f.id;
    const old = faceObjects.get(key);
    if (old) { try { (document as any).fonts.delete(old); } catch { /* */ } }
    const ff = new FontFace(f.family, bytes.slice().buffer, { weight: String(f.weight), style: f.style });
    faceObjects.set(key, ff);
    (document as any).fonts.add(ff);
    ff.load().catch(() => undefined);
  } catch { /* unsupported format for this browser */ }
}

function unregisterFace(id: string): void {
  const ff = faceObjects.get(id);
  if (ff && typeof document !== 'undefined' && (document as any).fonts) { try { (document as any).fonts.delete(ff); } catch { /* */ } }
  faceObjects.delete(id);
}

const fontId = () => `uf${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/**
 * Adds a font from a file: parses it, keeps its bytes on this device (unless `session` is set) and
 * registers it for the screen. A font with the same family, weight and style replaces the old one.
 */
export async function addUserFont(bytes: Uint8Array, fileName: string, opts: { session?: boolean; packaged?: boolean } = {}): Promise<UserFont> {
  const { parseFontFile } = await import('./export/fonts/fontfile');
  const p = await parseFontFile(bytes, fileName);
  const dup = userFonts().find((f) => f.family.toLowerCase() === p.family.toLowerCase() && f.weight === p.weight && f.style === p.style);
  if (dup) await removeUserFont(dup.id);
  const f: UserFont = { id: fontId(), family: p.family, subfamily: p.subfamily, psName: p.psName, weight: p.weight, style: p.style, format: p.format, file: fileName.replace(/^.*[\\/]/, ''), size: bytes.length, fsType: p.fsType, embeddable: p.embeddable, ...(p.cff ? { cff: true } : {}), ...(opts.packaged ? { packaged: true } : {}), added: Date.now() };
  // Keep the parsed sfnt for WOFF (the PDF writer and the screen both take it); other formats as they are.
  const keep = p.format === 'woff' && p.sfnt ? p.sfnt : bytes.slice();
  userFontMap.set(f.id, f);
  userFontData.set(f.id, keep);
  if (!opts.session && !opts.packaged) await persistUserFont(f, keep);
  registerFace(f, keep);
  notify();
  return f;
}

async function persistUserFont(f: UserFont, bytes: Uint8Array): Promise<void> {
  try {
    await kvSet('font:' + f.id, { meta: f, data: bytes.slice().buffer });
    const back = await kvGet<any>('font:' + f.id);
    if (!back?.data || !(back.data.byteLength > 0)) throw new Error('not stored');
  } catch {
    // No IndexedDB (private window, blocked storage): the font lasts for this session.
    f.packaged = true;
    notify();
  }
}

/** Removes a font from this device (and from the screen). */
export async function removeUserFont(id: string): Promise<void> {
  const f = userFontMap.get(id);
  if (!f) return;
  userFontMap.delete(id);
  userFontData.delete(id);
  unregisterFace(id);
  if (!f.packaged) await kvDel('font:' + id);
  notify();
}

/** Keeps a packaged (session) font on this device. */
export async function installUserFont(id: string): Promise<void> {
  const f = userFontMap.get(id), bytes = userFontData.get(id);
  if (!f || !bytes) return;
  delete f.packaged;
  await persistUserFont(f, bytes);
  notify();
}

/** Loads the fonts kept on this device and registers them (once). */
export function installUserFonts(): Promise<void> {
  if (installed) return installed;
  installed = (async () => {
    let keys: string[] = [];
    try { keys = await kvKeys('font:'); } catch { return; }
    for (const k of keys) {
      try {
        const rec = await kvGet<{ meta: UserFont; data: ArrayBuffer }>(k);
        if (!rec?.meta || !rec.data) continue;
        const bytes = new Uint8Array(rec.data);
        const f: UserFont = { ...rec.meta };
        delete f.packaged;
        userFontMap.set(f.id, f);
        userFontData.set(f.id, bytes);
        registerFace(f, bytes);
      } catch { /* a damaged record is skipped */ }
    }
    if (keys.length) notify();
  })();
  return installed;
}

/** Fonts that arrived inside a publication package, registered for the session (not kept on the device). */
export interface PackagedFontEntry { id?: string; family: string; weight: number; style: 'normal' | 'italic'; format: UserFontFormat; file: string; psName?: string; bytes: Uint8Array }

let packagedHook: ((fonts: UserFont[]) => void) | null = null;
/** The UI sets this to offer installing packaged fonts when a publication opens. */
export function onPackagedFonts(fn: ((fonts: UserFont[]) => void) | null): void { packagedHook = fn; }

export async function registerPackagedFonts(entries: PackagedFontEntry[]): Promise<UserFont[]> {
  const out: UserFont[] = [];
  for (const e of entries) {
    // A font already on the device wins; a packaged copy of the same face is skipped.
    if (userFonts().some((f) => !f.packaged && f.family.toLowerCase() === e.family.toLowerCase() && f.weight === e.weight && f.style === e.style)) continue;
    try { out.push(await addUserFont(e.bytes, e.file, { packaged: true })); } catch { /* not a font */ }
  }
  if (out.length) packagedHook?.(out);
  return out;
}

/** The user's fonts a publication uses (by family), for packaging. */
export function userFontsFor(families: string[]): UserFont[] {
  const want = new Set(families.map((f) => f.trim().toLowerCase()));
  return userFonts().filter((f) => want.has(f.family.toLowerCase()));
}

/** Clears the registry (tests). */
export function resetUserFonts(): void {
  for (const id of [...userFontMap.keys()]) unregisterFace(id);
  userFontMap.clear(); userFontData.clear(); installed = null;
  notify();
}
