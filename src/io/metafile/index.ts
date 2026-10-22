/**
 * Windows metafiles (WMF, EMF) converted to SVG, so pictures stored in that form (Publisher's clip art,
 * placed .wmf/.emf files) show and print like any other drawing.
 *
 * The converter is original code written from the published structure of the formats, with
 * LibreOffice's metafile reader (emfio, MPL) consulted as a description only.
 */
import { playWmf } from './wmf';
import { isEmf, playEmf } from './emf';
import type { MetafileHints } from './objects';

export type { MetafileHints } from './objects';
export { isEmf } from './emf';

/** True for a placeable WMF, a plain WMF header (memory or disk metafile, 9-word header) or an EMF. */
export function isMetafile(d: Uint8Array): boolean {
  if (d.length < 18) return false;
  if (d[0] === 0xd7 && d[1] === 0xcd && d[2] === 0xc6 && d[3] === 0x9a) return true;
  if ((d[0] === 1 || d[0] === 2) && d[1] === 0 && d[2] === 9 && d[3] === 0 && (d[4] === 0 || d[4] === 3) && d[5] === 3) return true;
  return isEmf(d);
}

/**
 * Converts a WMF or EMF to SVG: `w`/`h` are the picture's natural size in points. Returns null when
 * the data is not a metafile or draws nothing; never throws.
 */
export function metafileToSvg(bytes: Uint8Array, hints: MetafileHints = {}): { svg: string; w: number; h: number } | null {
  try {
    if (isEmf(bytes)) return playEmf(bytes, hints);
    return playWmf(bytes, hints);
  } catch {
    return null;
  }
}
