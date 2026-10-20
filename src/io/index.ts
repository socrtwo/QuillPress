/**
 * File format registry: detection by content, import (with automatic recovery of damaged files)
 * and export. Importers load on demand so the app starts without them.
 */
import type { Pub } from '../model/pub';
import type { RecoveryReport } from './recover';

export interface FormatDef { id: string; label: string; ext: string[]; mime: string; canImport: boolean; canExport: boolean }

export const QPP_MIME = 'application/x-quillpress';
export const QPPE_MIME = 'application/x-quillpress-encrypted';
export const SLA_MIME = 'application/x-scribus';
export const IDML_MIME = 'application/vnd.adobe.indesign-idml-package';

export const FORMATS: FormatDef[] = [
  { id: 'qpp', label: 'QuillPress Publication', ext: ['qpp'], mime: QPP_MIME, canImport: true, canExport: true },
  { id: 'qppe', label: 'Encrypted QuillPress Publication', ext: ['qppe'], mime: QPPE_MIME, canImport: true, canExport: true },
  { id: 'sla', label: 'Scribus Document', ext: ['sla'], mime: SLA_MIME, canImport: true, canExport: true },
  { id: 'json', label: 'QuillPress JSON', ext: ['json'], mime: 'application/json', canImport: true, canExport: true },
  { id: 'svg', label: 'SVG Page', ext: ['svg'], mime: 'image/svg+xml', canImport: true, canExport: false },
  { id: 'txt', label: 'Plain Text', ext: ['txt'], mime: 'text/plain', canImport: true, canExport: false },
  { id: 'md', label: 'Markdown', ext: ['md', 'markdown'], mime: 'text/markdown', canImport: true, canExport: false },
  { id: 'rtf', label: 'Rich Text', ext: ['rtf'], mime: 'application/rtf', canImport: true, canExport: false },
  { id: 'docx', label: 'Word Document', ext: ['docx'], mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', canImport: true, canExport: false },
  { id: 'html', label: 'Web Page', ext: ['html', 'htm'], mime: 'text/html', canImport: true, canExport: false },
  { id: 'image', label: 'Picture', ext: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff'], mime: 'image/*', canImport: true, canExport: false },
  // Other page layout programs' formats (docs/FORMATS.md says how much of each is read).
  { id: 'idml', label: 'InDesign Markup (IDML)', ext: ['idml'], mime: IDML_MIME, canImport: true, canExport: true },
  { id: 'indd', label: 'InDesign Document', ext: ['indd', 'indt'], mime: 'application/x-indesign', canImport: true, canExport: false },
  { id: 'pub', label: 'Microsoft Publisher Publication', ext: ['pub'], mime: 'application/x-mspublisher', canImport: true, canExport: false },
  { id: 'qxp', label: 'QuarkXPress Document', ext: ['qxp', 'qxd', 'qxt'], mime: 'application/vnd.quark.quarkxpress', canImport: true, canExport: false },
  { id: 'pmd', label: 'PageMaker Publication', ext: ['pmd', 'p65', 'pm6', 'pmt', 'pm5'], mime: 'application/x-pagemaker', canImport: true, canExport: false },
  { id: 'mif', label: 'FrameMaker Interchange (MIF)', ext: ['mif'], mime: 'application/x-mif', canImport: true, canExport: false },
  { id: 'xtg', label: 'XPress Tags', ext: ['xtg'], mime: 'text/x-xpress-tags', canImport: true, canExport: false },
];

export function formatById(id: string): FormatDef | undefined { return FORMATS.find((f) => f.id === id); }

export function formatFromName(name: string): FormatDef | undefined {
  const ext = /\.([a-z0-9]+)$/i.exec(name || '')?.[1]?.toLowerCase();
  return ext ? FORMATS.find((f) => f.ext.includes(ext)) : undefined;
}

export class PasswordNeeded extends Error {
  constructor(message = 'This publication is encrypted; enter its password to open it.') { super(message); this.name = 'PasswordNeeded'; }
}

const ascii = (u8: Uint8Array, from: number, to: number) => { let s = ''; for (let i = from; i < Math.min(u8.length, to); i++) s += String.fromCharCode(u8[i]); return s; };
const contains = (u8: Uint8Array, s: string, limit = u8.length) => {
  const n = s.length;
  outer: for (let i = 0; i <= Math.min(u8.length, limit) - n; i++) {
    for (let j = 0; j < n; j++) if (u8[i + j] !== s.charCodeAt(j)) continue outer;
    return true;
  }
  return false;
};

/** Detects the format by content, falling back to the extension. */
export function sniffFormat(data: Uint8Array, name: string): string | null {
  const byName = formatFromName(name)?.id || null;
  if (!data.length) return byName;
  const head = ascii(data, 0, 12);
  if (head.startsWith('QFDE1')) return 'qppe';
  if (head.startsWith('PK\x03\x04') || head.startsWith('PK\x05\x06')) {
    if (contains(data, QPP_MIME, 120)) return 'qpp';
    if (contains(data, 'publication.json', 4096)) return 'qpp';
    if (contains(data, IDML_MIME, 160) || contains(data, 'designmap.xml')) return 'idml';
    if (contains(data, 'word/document.xml') || contains(data, 'word/')) return 'docx';
    return byName;
  }
  if (head.startsWith('\x89PNG') || head.startsWith('\xff\xd8\xff') || head.startsWith('GIF8') || head.startsWith('BM') || head.startsWith('II*\x00') || head.startsWith('MM\x00*') || (head.startsWith('RIFF') && ascii(data, 8, 12) === 'WEBP')) return 'image';
  if (head.startsWith('{\\rtf')) return 'rtf';
  if (data[0] === 0x06 && data[1] === 0x06 && data[2] === 0xed && data[3] === 0xf5) return 'indd';
  if (data[0] === 0xd0 && data[1] === 0xcf && data[2] === 0x11 && data[3] === 0xe0) return byName === 'pub' || contains(data, 'Q\x00u\x00i\x00l\x00l\x00') ? 'pub' : byName;
  if (/^.{2}(MM|II)XPR[0-9]/s.test(head)) return 'qxp';
  // A Mac QuarkXPress file wrapped in MacBinary: the header starts after the 128-byte MacBinary block.
  if (data.length > 140 && /^(MM|II)XPR[0-9]/.test(ascii(data, 130, 136))) return 'qxp';
  if (((data[0] === 0 && data[1] === 0 && data[2] === 0xff && data[3] === 0xff) || (data[0] === 0xff && data[1] === 0xff && data[2] === 0 && data[3] === 0)) && (contains(data, 'PageMaker', 8192) || byName === 'pmd')) return 'pmd';
  const text = new TextDecoder().decode(data.subarray(0, 4096)).replace(/^﻿/, '');
  if (/^\s*<MIFFile/.test(text)) return 'mif';
  if (/^<v\d+(\.\d+)?><e\d>/.test(text) || (byName === 'xtg' && /^@/.test(text))) return 'xtg';
  if (/^\s*</.test(text) && /<SCRIBUSUTF8NEW|<SCRIBUS/i.test(text)) return 'sla';
  if (/^\s*</.test(text) && /<svg[\s>]/i.test(text)) return 'svg';
  if (/^\s*</.test(text) && /<(!doctype\s+html|html|body)[\s>]/i.test(text)) return 'html';
  if (/^\s*\{/.test(text) && /"format"\s*:\s*"quillpress"/.test(text)) return 'json';
  if (byName === 'md' || byName === 'txt') return byName;
  if (/^#{1,6}\s/m.test(text) || /^\s*[-*]\s/m.test(text)) return 'md';
  return byName || 'txt';
}

export interface ImportResult { pub: Pub; format: string; warnings: string[]; recovery?: RecoveryReport }

/**
 * Opens a file as a publication. Text and pictures become a new publication with one page holding
 * them. Damaged files go through the recovery pipeline unless noRecovery is set.
 */
export async function importPublication(data: Uint8Array, name: string, opts: { repair?: boolean; password?: string; noRecovery?: boolean } = {}): Promise<ImportResult> {
  const format = sniffFormat(data, name) || 'qpp';
  const warnings: string[] = [];
  const byName = formatFromName(name)?.id;
  if (byName && byName !== format && !(byName === 'txt' && format === 'md')) warnings.push(`The file is named .${name.split('.').pop()} but contains ${formatById(format)?.label || format}; it was opened as that.`);
  const normal = async (): Promise<Pub> => {
    switch (format) {
      case 'qpp': return (await import('./qpp')).importQpp(data);
      case 'qppe': {
        if (!opts.password) throw new PasswordNeeded();
        return (await import('./qpp')).importQppe(data, opts.password);
      }
      case 'json': return (await import('./qpp')).importJson(data);
      case 'sla': { const r = await (await import('./sla')).importSla(data); warnings.push(...r.warnings); return r.pub; }
      case 'idml': { const r = await (await import('./idml')).importIdml(data); warnings.push(...r.warnings); return r.pub; }
      case 'pub': { const r = await (await import('./mspub')).importMsPub(data, name); warnings.push(...r.warnings); return r.pub; }
      case 'indd': case 'qxp': case 'pmd': { const r = await (await import('./legacyLayout')).importLegacyLayout(data, name, format); warnings.push(...r.warnings); return r.pub; }
      case 'mif': { const r = (await import('./mif')).importMif((await import('./xml')).decodeXml(data), name); warnings.push(...r.warnings); return r.pub; }
      case 'xtg': { const r = (await import('./xpressTags')).importXpressTags(data, name); warnings.push(...r.warnings); return r.pub; }
      case 'svg': return (await import('./images')).publicationFromSvg(data, name);
      case 'image': return (await import('./images')).publicationFromImage(data, name);
      case 'txt': case 'md': case 'rtf': case 'docx': case 'html': {
        const { importTextFile } = await import('./textImport');
        const r = await importTextFile(data, name, format);
        warnings.push(...r.warnings);
        const { Pub } = await import('../model/pub');
        const pub = Pub.blank();
        const [mt, mr, mb, ml] = pub.data.masters[0].margins;
        const f = pub.newTextFrame({ x: ml, y: mt, w: pub.size.w - ml - mr, h: pub.size.h - mt - mb }, r.paras);
        f.name = name.replace(/\.[^.]+$/, '');
        pub.pages[0].items.push(f);
        // Autoflow onto more pages.
        const { autoflowStory } = await import('../edit/flowOps');
        autoflowStory(pub, f);
        return pub;
      }
      default: throw new Error(`Unsupported format: ${format}`);
    }
  };
  if (!opts.repair) {
    try {
      const pub = await normal();
      return { pub, format, warnings };
    } catch (e) {
      if (e instanceof PasswordNeeded || opts.noRecovery) throw e;
      warnings.push(`Normal open failed: ${(e as any)?.message || e}`);
    }
  }
  const { recoverPublication } = await import('./recover');
  const report = await recoverPublication(data, name, { forceRepair: !!opts.repair });
  if (!report.pub) throw new Error(report.summary || 'The file could not be opened or repaired.');
  return { pub: report.pub, format, warnings, recovery: report };
}

export interface ExportResult { data: Uint8Array; mime: string; ext: string }

export async function exportPublication(pub: Pub, format: string, opts: { password?: string } = {}): Promise<ExportResult> {
  switch (format) {
    case 'qpp': return { data: await (await import('./qpp')).exportQpp(pub), mime: QPP_MIME, ext: 'qpp' };
    case 'qppe': {
      if (!opts.password) throw new Error('A password is needed to save an encrypted publication.');
      return { data: await (await import('./qpp')).exportQppe(pub, opts.password), mime: QPPE_MIME, ext: 'qppe' };
    }
    case 'json': return { data: (await import('./qpp')).exportJson(pub), mime: 'application/json', ext: 'json' };
    case 'sla': return { data: (await import('./sla')).exportSla(pub), mime: SLA_MIME, ext: 'sla' };
    case 'idml': return { data: await (await import('./idmlExport')).exportIdml(pub), mime: IDML_MIME, ext: 'idml' };
    default: throw new Error(`Cannot save as ${format}`);
  }
}
