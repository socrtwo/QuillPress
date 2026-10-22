/**
 * WOFF (1.0) sources of the bundled fonts for PDF embedding: the latin subset of every family in
 * src/fonts.ts, regular and bold, upright and italic. The PDF writer turns a WOFF into a TrueType
 * subset at export time (woff.ts, truetype.ts); the screen uses the WOFF2 files that fonts.ts loads.
 */
import tinos_400_normal from '@fontsource/tinos/files/tinos-latin-400-normal.woff?url';
import tinos_400_italic from '@fontsource/tinos/files/tinos-latin-400-italic.woff?url';
import tinos_700_normal from '@fontsource/tinos/files/tinos-latin-700-normal.woff?url';
import tinos_700_italic from '@fontsource/tinos/files/tinos-latin-700-italic.woff?url';
import arimo_400_normal from '@fontsource/arimo/files/arimo-latin-400-normal.woff?url';
import arimo_400_italic from '@fontsource/arimo/files/arimo-latin-400-italic.woff?url';
import arimo_700_normal from '@fontsource/arimo/files/arimo-latin-700-normal.woff?url';
import arimo_700_italic from '@fontsource/arimo/files/arimo-latin-700-italic.woff?url';
import cousine_400_normal from '@fontsource/cousine/files/cousine-latin-400-normal.woff?url';
import cousine_400_italic from '@fontsource/cousine/files/cousine-latin-400-italic.woff?url';
import cousine_700_normal from '@fontsource/cousine/files/cousine-latin-700-normal.woff?url';
import cousine_700_italic from '@fontsource/cousine/files/cousine-latin-700-italic.woff?url';
import carlito_400_normal from '@fontsource/carlito/files/carlito-latin-400-normal.woff?url';
import carlito_400_italic from '@fontsource/carlito/files/carlito-latin-400-italic.woff?url';
import carlito_700_normal from '@fontsource/carlito/files/carlito-latin-700-normal.woff?url';
import carlito_700_italic from '@fontsource/carlito/files/carlito-latin-700-italic.woff?url';
import caladea_400_normal from '@fontsource/caladea/files/caladea-latin-400-normal.woff?url';
import caladea_400_italic from '@fontsource/caladea/files/caladea-latin-400-italic.woff?url';
import caladea_700_normal from '@fontsource/caladea/files/caladea-latin-700-normal.woff?url';
import caladea_700_italic from '@fontsource/caladea/files/caladea-latin-700-italic.woff?url';
import gelasio_400_normal from '@fontsource/gelasio/files/gelasio-latin-400-normal.woff?url';
import gelasio_400_italic from '@fontsource/gelasio/files/gelasio-latin-400-italic.woff?url';
import gelasio_700_normal from '@fontsource/gelasio/files/gelasio-latin-700-normal.woff?url';
import gelasio_700_italic from '@fontsource/gelasio/files/gelasio-latin-700-italic.woff?url';
import eb_garamond_400_normal from '@fontsource/eb-garamond/files/eb-garamond-latin-400-normal.woff?url';
import eb_garamond_400_italic from '@fontsource/eb-garamond/files/eb-garamond-latin-400-italic.woff?url';
import eb_garamond_700_normal from '@fontsource/eb-garamond/files/eb-garamond-latin-700-normal.woff?url';
import eb_garamond_700_italic from '@fontsource/eb-garamond/files/eb-garamond-latin-700-italic.woff?url';
import courier_prime_400_normal from '@fontsource/courier-prime/files/courier-prime-latin-400-normal.woff?url';
import courier_prime_400_italic from '@fontsource/courier-prime/files/courier-prime-latin-400-italic.woff?url';
import courier_prime_700_normal from '@fontsource/courier-prime/files/courier-prime-latin-700-normal.woff?url';
import courier_prime_700_italic from '@fontsource/courier-prime/files/courier-prime-latin-700-italic.woff?url';
import libre_baskerville_400_normal from '@fontsource/libre-baskerville/files/libre-baskerville-latin-400-normal.woff?url';
import libre_baskerville_400_italic from '@fontsource/libre-baskerville/files/libre-baskerville-latin-400-italic.woff?url';
import libre_baskerville_700_normal from '@fontsource/libre-baskerville/files/libre-baskerville-latin-700-normal.woff?url';
import libre_baskerville_700_italic from '@fontsource/libre-baskerville/files/libre-baskerville-latin-700-italic.woff?url';
import lato_400_normal from '@fontsource/lato/files/lato-latin-400-normal.woff?url';
import lato_400_italic from '@fontsource/lato/files/lato-latin-400-italic.woff?url';
import lato_700_normal from '@fontsource/lato/files/lato-latin-700-normal.woff?url';
import lato_700_italic from '@fontsource/lato/files/lato-latin-700-italic.woff?url';
import merriweather_400_normal from '@fontsource/merriweather/files/merriweather-latin-400-normal.woff?url';
import merriweather_400_italic from '@fontsource/merriweather/files/merriweather-latin-400-italic.woff?url';
import merriweather_700_normal from '@fontsource/merriweather/files/merriweather-latin-700-normal.woff?url';
import merriweather_700_italic from '@fontsource/merriweather/files/merriweather-latin-700-italic.woff?url';
import open_sans_400_normal from '@fontsource/open-sans/files/open-sans-latin-400-normal.woff?url';
import open_sans_400_italic from '@fontsource/open-sans/files/open-sans-latin-400-italic.woff?url';
import open_sans_700_normal from '@fontsource/open-sans/files/open-sans-latin-700-normal.woff?url';
import open_sans_700_italic from '@fontsource/open-sans/files/open-sans-latin-700-italic.woff?url';

// Extended subsets of the four metric-compatible core families: the PDF writer takes characters the
// latin files lack (accented Latin beyond Western Europe, Cyrillic, Greek) from these.
import tinos_latin_ext_400_normal from '@fontsource/tinos/files/tinos-latin-ext-400-normal.woff?url';
import tinos_latin_ext_400_italic from '@fontsource/tinos/files/tinos-latin-ext-400-italic.woff?url';
import tinos_latin_ext_700_normal from '@fontsource/tinos/files/tinos-latin-ext-700-normal.woff?url';
import tinos_latin_ext_700_italic from '@fontsource/tinos/files/tinos-latin-ext-700-italic.woff?url';
import tinos_cyrillic_400_normal from '@fontsource/tinos/files/tinos-cyrillic-400-normal.woff?url';
import tinos_cyrillic_400_italic from '@fontsource/tinos/files/tinos-cyrillic-400-italic.woff?url';
import tinos_cyrillic_700_normal from '@fontsource/tinos/files/tinos-cyrillic-700-normal.woff?url';
import tinos_cyrillic_700_italic from '@fontsource/tinos/files/tinos-cyrillic-700-italic.woff?url';
import tinos_greek_400_normal from '@fontsource/tinos/files/tinos-greek-400-normal.woff?url';
import tinos_greek_400_italic from '@fontsource/tinos/files/tinos-greek-400-italic.woff?url';
import tinos_greek_700_normal from '@fontsource/tinos/files/tinos-greek-700-normal.woff?url';
import tinos_greek_700_italic from '@fontsource/tinos/files/tinos-greek-700-italic.woff?url';
import arimo_latin_ext_400_normal from '@fontsource/arimo/files/arimo-latin-ext-400-normal.woff?url';
import arimo_latin_ext_400_italic from '@fontsource/arimo/files/arimo-latin-ext-400-italic.woff?url';
import arimo_latin_ext_700_normal from '@fontsource/arimo/files/arimo-latin-ext-700-normal.woff?url';
import arimo_latin_ext_700_italic from '@fontsource/arimo/files/arimo-latin-ext-700-italic.woff?url';
import arimo_cyrillic_400_normal from '@fontsource/arimo/files/arimo-cyrillic-400-normal.woff?url';
import arimo_cyrillic_400_italic from '@fontsource/arimo/files/arimo-cyrillic-400-italic.woff?url';
import arimo_cyrillic_700_normal from '@fontsource/arimo/files/arimo-cyrillic-700-normal.woff?url';
import arimo_cyrillic_700_italic from '@fontsource/arimo/files/arimo-cyrillic-700-italic.woff?url';
import arimo_greek_400_normal from '@fontsource/arimo/files/arimo-greek-400-normal.woff?url';
import arimo_greek_400_italic from '@fontsource/arimo/files/arimo-greek-400-italic.woff?url';
import arimo_greek_700_normal from '@fontsource/arimo/files/arimo-greek-700-normal.woff?url';
import arimo_greek_700_italic from '@fontsource/arimo/files/arimo-greek-700-italic.woff?url';
import cousine_latin_ext_400_normal from '@fontsource/cousine/files/cousine-latin-ext-400-normal.woff?url';
import cousine_latin_ext_400_italic from '@fontsource/cousine/files/cousine-latin-ext-400-italic.woff?url';
import cousine_latin_ext_700_normal from '@fontsource/cousine/files/cousine-latin-ext-700-normal.woff?url';
import cousine_latin_ext_700_italic from '@fontsource/cousine/files/cousine-latin-ext-700-italic.woff?url';
import cousine_cyrillic_400_normal from '@fontsource/cousine/files/cousine-cyrillic-400-normal.woff?url';
import cousine_cyrillic_400_italic from '@fontsource/cousine/files/cousine-cyrillic-400-italic.woff?url';
import cousine_cyrillic_700_normal from '@fontsource/cousine/files/cousine-cyrillic-700-normal.woff?url';
import cousine_cyrillic_700_italic from '@fontsource/cousine/files/cousine-cyrillic-700-italic.woff?url';
import cousine_greek_400_normal from '@fontsource/cousine/files/cousine-greek-400-normal.woff?url';
import cousine_greek_400_italic from '@fontsource/cousine/files/cousine-greek-400-italic.woff?url';
import cousine_greek_700_normal from '@fontsource/cousine/files/cousine-greek-700-normal.woff?url';
import cousine_greek_700_italic from '@fontsource/cousine/files/cousine-greek-700-italic.woff?url';
import carlito_latin_ext_400_normal from '@fontsource/carlito/files/carlito-latin-ext-400-normal.woff?url';
import carlito_latin_ext_400_italic from '@fontsource/carlito/files/carlito-latin-ext-400-italic.woff?url';
import carlito_latin_ext_700_normal from '@fontsource/carlito/files/carlito-latin-ext-700-normal.woff?url';
import carlito_latin_ext_700_italic from '@fontsource/carlito/files/carlito-latin-ext-700-italic.woff?url';
import carlito_cyrillic_400_normal from '@fontsource/carlito/files/carlito-cyrillic-400-normal.woff?url';
import carlito_cyrillic_400_italic from '@fontsource/carlito/files/carlito-cyrillic-400-italic.woff?url';
import carlito_cyrillic_700_normal from '@fontsource/carlito/files/carlito-cyrillic-700-normal.woff?url';
import carlito_cyrillic_700_italic from '@fontsource/carlito/files/carlito-cyrillic-700-italic.woff?url';
import carlito_greek_400_normal from '@fontsource/carlito/files/carlito-greek-400-normal.woff?url';
import carlito_greek_400_italic from '@fontsource/carlito/files/carlito-greek-400-italic.woff?url';
import carlito_greek_700_normal from '@fontsource/carlito/files/carlito-greek-700-normal.woff?url';
import carlito_greek_700_italic from '@fontsource/carlito/files/carlito-greek-700-italic.woff?url';

export interface WoffSource { family: string; weight: 400 | 700; style: 'normal' | 'italic'; url: string }

export const WOFF_SOURCES: WoffSource[] = [
  { family: 'Tinos', weight: 400, style: 'normal', url: tinos_400_normal },
  { family: 'Tinos', weight: 400, style: 'italic', url: tinos_400_italic },
  { family: 'Tinos', weight: 700, style: 'normal', url: tinos_700_normal },
  { family: 'Tinos', weight: 700, style: 'italic', url: tinos_700_italic },
  { family: 'Arimo', weight: 400, style: 'normal', url: arimo_400_normal },
  { family: 'Arimo', weight: 400, style: 'italic', url: arimo_400_italic },
  { family: 'Arimo', weight: 700, style: 'normal', url: arimo_700_normal },
  { family: 'Arimo', weight: 700, style: 'italic', url: arimo_700_italic },
  { family: 'Cousine', weight: 400, style: 'normal', url: cousine_400_normal },
  { family: 'Cousine', weight: 400, style: 'italic', url: cousine_400_italic },
  { family: 'Cousine', weight: 700, style: 'normal', url: cousine_700_normal },
  { family: 'Cousine', weight: 700, style: 'italic', url: cousine_700_italic },
  { family: 'Carlito', weight: 400, style: 'normal', url: carlito_400_normal },
  { family: 'Carlito', weight: 400, style: 'italic', url: carlito_400_italic },
  { family: 'Carlito', weight: 700, style: 'normal', url: carlito_700_normal },
  { family: 'Carlito', weight: 700, style: 'italic', url: carlito_700_italic },
  { family: 'Caladea', weight: 400, style: 'normal', url: caladea_400_normal },
  { family: 'Caladea', weight: 400, style: 'italic', url: caladea_400_italic },
  { family: 'Caladea', weight: 700, style: 'normal', url: caladea_700_normal },
  { family: 'Caladea', weight: 700, style: 'italic', url: caladea_700_italic },
  { family: 'Gelasio', weight: 400, style: 'normal', url: gelasio_400_normal },
  { family: 'Gelasio', weight: 400, style: 'italic', url: gelasio_400_italic },
  { family: 'Gelasio', weight: 700, style: 'normal', url: gelasio_700_normal },
  { family: 'Gelasio', weight: 700, style: 'italic', url: gelasio_700_italic },
  { family: 'EB Garamond', weight: 400, style: 'normal', url: eb_garamond_400_normal },
  { family: 'EB Garamond', weight: 400, style: 'italic', url: eb_garamond_400_italic },
  { family: 'EB Garamond', weight: 700, style: 'normal', url: eb_garamond_700_normal },
  { family: 'EB Garamond', weight: 700, style: 'italic', url: eb_garamond_700_italic },
  { family: 'Courier Prime', weight: 400, style: 'normal', url: courier_prime_400_normal },
  { family: 'Courier Prime', weight: 400, style: 'italic', url: courier_prime_400_italic },
  { family: 'Courier Prime', weight: 700, style: 'normal', url: courier_prime_700_normal },
  { family: 'Courier Prime', weight: 700, style: 'italic', url: courier_prime_700_italic },
  { family: 'Libre Baskerville', weight: 400, style: 'normal', url: libre_baskerville_400_normal },
  { family: 'Libre Baskerville', weight: 400, style: 'italic', url: libre_baskerville_400_italic },
  { family: 'Libre Baskerville', weight: 700, style: 'normal', url: libre_baskerville_700_normal },
  { family: 'Libre Baskerville', weight: 700, style: 'italic', url: libre_baskerville_700_italic },
  { family: 'Lato', weight: 400, style: 'normal', url: lato_400_normal },
  { family: 'Lato', weight: 400, style: 'italic', url: lato_400_italic },
  { family: 'Lato', weight: 700, style: 'normal', url: lato_700_normal },
  { family: 'Lato', weight: 700, style: 'italic', url: lato_700_italic },
  { family: 'Merriweather', weight: 400, style: 'normal', url: merriweather_400_normal },
  { family: 'Merriweather', weight: 400, style: 'italic', url: merriweather_400_italic },
  { family: 'Merriweather', weight: 700, style: 'normal', url: merriweather_700_normal },
  { family: 'Merriweather', weight: 700, style: 'italic', url: merriweather_700_italic },
  { family: 'Open Sans', weight: 400, style: 'normal', url: open_sans_400_normal },
  { family: 'Open Sans', weight: 400, style: 'italic', url: open_sans_400_italic },
  { family: 'Open Sans', weight: 700, style: 'normal', url: open_sans_700_normal },
  { family: 'Open Sans', weight: 700, style: 'italic', url: open_sans_700_italic },
];

/** The source of a face, or null when the family is not bundled. */
export function woffSource(family: string, weight: 400 | 700, style: 'normal' | 'italic'): WoffSource | null {
  return WOFF_SOURCES.find((s) => s.family === family && s.weight === weight && s.style === style) || null;
}

export interface SubsetSource extends WoffSource { subset: 'latin-ext' | 'cyrillic' | 'greek' }

export const SUBSET_SOURCES: SubsetSource[] = [
  { family: 'Tinos', subset: 'latin-ext', weight: 400, style: 'normal', url: tinos_latin_ext_400_normal },
  { family: 'Tinos', subset: 'latin-ext', weight: 400, style: 'italic', url: tinos_latin_ext_400_italic },
  { family: 'Tinos', subset: 'latin-ext', weight: 700, style: 'normal', url: tinos_latin_ext_700_normal },
  { family: 'Tinos', subset: 'latin-ext', weight: 700, style: 'italic', url: tinos_latin_ext_700_italic },
  { family: 'Tinos', subset: 'cyrillic', weight: 400, style: 'normal', url: tinos_cyrillic_400_normal },
  { family: 'Tinos', subset: 'cyrillic', weight: 400, style: 'italic', url: tinos_cyrillic_400_italic },
  { family: 'Tinos', subset: 'cyrillic', weight: 700, style: 'normal', url: tinos_cyrillic_700_normal },
  { family: 'Tinos', subset: 'cyrillic', weight: 700, style: 'italic', url: tinos_cyrillic_700_italic },
  { family: 'Tinos', subset: 'greek', weight: 400, style: 'normal', url: tinos_greek_400_normal },
  { family: 'Tinos', subset: 'greek', weight: 400, style: 'italic', url: tinos_greek_400_italic },
  { family: 'Tinos', subset: 'greek', weight: 700, style: 'normal', url: tinos_greek_700_normal },
  { family: 'Tinos', subset: 'greek', weight: 700, style: 'italic', url: tinos_greek_700_italic },
  { family: 'Arimo', subset: 'latin-ext', weight: 400, style: 'normal', url: arimo_latin_ext_400_normal },
  { family: 'Arimo', subset: 'latin-ext', weight: 400, style: 'italic', url: arimo_latin_ext_400_italic },
  { family: 'Arimo', subset: 'latin-ext', weight: 700, style: 'normal', url: arimo_latin_ext_700_normal },
  { family: 'Arimo', subset: 'latin-ext', weight: 700, style: 'italic', url: arimo_latin_ext_700_italic },
  { family: 'Arimo', subset: 'cyrillic', weight: 400, style: 'normal', url: arimo_cyrillic_400_normal },
  { family: 'Arimo', subset: 'cyrillic', weight: 400, style: 'italic', url: arimo_cyrillic_400_italic },
  { family: 'Arimo', subset: 'cyrillic', weight: 700, style: 'normal', url: arimo_cyrillic_700_normal },
  { family: 'Arimo', subset: 'cyrillic', weight: 700, style: 'italic', url: arimo_cyrillic_700_italic },
  { family: 'Arimo', subset: 'greek', weight: 400, style: 'normal', url: arimo_greek_400_normal },
  { family: 'Arimo', subset: 'greek', weight: 400, style: 'italic', url: arimo_greek_400_italic },
  { family: 'Arimo', subset: 'greek', weight: 700, style: 'normal', url: arimo_greek_700_normal },
  { family: 'Arimo', subset: 'greek', weight: 700, style: 'italic', url: arimo_greek_700_italic },
  { family: 'Cousine', subset: 'latin-ext', weight: 400, style: 'normal', url: cousine_latin_ext_400_normal },
  { family: 'Cousine', subset: 'latin-ext', weight: 400, style: 'italic', url: cousine_latin_ext_400_italic },
  { family: 'Cousine', subset: 'latin-ext', weight: 700, style: 'normal', url: cousine_latin_ext_700_normal },
  { family: 'Cousine', subset: 'latin-ext', weight: 700, style: 'italic', url: cousine_latin_ext_700_italic },
  { family: 'Cousine', subset: 'cyrillic', weight: 400, style: 'normal', url: cousine_cyrillic_400_normal },
  { family: 'Cousine', subset: 'cyrillic', weight: 400, style: 'italic', url: cousine_cyrillic_400_italic },
  { family: 'Cousine', subset: 'cyrillic', weight: 700, style: 'normal', url: cousine_cyrillic_700_normal },
  { family: 'Cousine', subset: 'cyrillic', weight: 700, style: 'italic', url: cousine_cyrillic_700_italic },
  { family: 'Cousine', subset: 'greek', weight: 400, style: 'normal', url: cousine_greek_400_normal },
  { family: 'Cousine', subset: 'greek', weight: 400, style: 'italic', url: cousine_greek_400_italic },
  { family: 'Cousine', subset: 'greek', weight: 700, style: 'normal', url: cousine_greek_700_normal },
  { family: 'Cousine', subset: 'greek', weight: 700, style: 'italic', url: cousine_greek_700_italic },
  { family: 'Carlito', subset: 'latin-ext', weight: 400, style: 'normal', url: carlito_latin_ext_400_normal },
  { family: 'Carlito', subset: 'latin-ext', weight: 400, style: 'italic', url: carlito_latin_ext_400_italic },
  { family: 'Carlito', subset: 'latin-ext', weight: 700, style: 'normal', url: carlito_latin_ext_700_normal },
  { family: 'Carlito', subset: 'latin-ext', weight: 700, style: 'italic', url: carlito_latin_ext_700_italic },
  { family: 'Carlito', subset: 'cyrillic', weight: 400, style: 'normal', url: carlito_cyrillic_400_normal },
  { family: 'Carlito', subset: 'cyrillic', weight: 400, style: 'italic', url: carlito_cyrillic_400_italic },
  { family: 'Carlito', subset: 'cyrillic', weight: 700, style: 'normal', url: carlito_cyrillic_700_normal },
  { family: 'Carlito', subset: 'cyrillic', weight: 700, style: 'italic', url: carlito_cyrillic_700_italic },
  { family: 'Carlito', subset: 'greek', weight: 400, style: 'normal', url: carlito_greek_400_normal },
  { family: 'Carlito', subset: 'greek', weight: 400, style: 'italic', url: carlito_greek_400_italic },
  { family: 'Carlito', subset: 'greek', weight: 700, style: 'normal', url: carlito_greek_700_normal },
  { family: 'Carlito', subset: 'greek', weight: 700, style: 'italic', url: carlito_greek_700_italic },
];

/** The extended subsets of a core family (Tinos, Arimo, Cousine, Carlito) for a weight and style. */
export function subsetSources(family: string, weight: 400 | 700, style: 'normal' | 'italic'): SubsetSource[] {
  return SUBSET_SOURCES.filter((s) => s.family === family && s.weight === weight && s.style === style);
}
