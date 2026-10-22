/**
 * Publication model. A publication is a set of pages built on master pages; every object on a page is
 * a frame (text, picture, shape, line, table or group). Text lives in stories, which flow through chains
 * of linked text frames, so one article can run across columns, frames and pages. Styles (paragraph,
 * character, object) are named and shared; an object or paragraph records only its overrides.
 *
 * Units: points (1/72 inch) for every position and size. Angles are degrees, clockwise. Colors are
 * '#rrggbb' or the name of a swatch.
 */

export type Color = string;

export type Fill =
  | { type: 'none' }
  | { type: 'solid'; color: Color; alpha?: number }
  | { type: 'gradient'; stops: { pos: number; color: Color }[]; angle?: number; path?: 'linear' | 'radial' }
  | { type: 'image'; media: string; mode?: 'stretch' | 'tile' | 'fit'; alpha?: number }
  | { type: 'pattern'; fg: Color; bg: Color; preset?: string };

export type Dash = 'solid' | 'dash' | 'dot' | 'dashDot' | 'longDash' | 'longDashDot' | 'sysDash' | 'sysDot';
export type ArrowEnd = 'none' | 'triangle' | 'arrow' | 'stealth' | 'diamond' | 'oval';

export interface Line {
  fill?: Fill;
  width?: number;
  dash?: Dash;
  head?: ArrowEnd;
  tail?: ArrowEnd;
  cap?: 'flat' | 'round' | 'square';
  join?: 'miter' | 'round' | 'bevel';
}

export interface Effects {
  shadow?: { color: Color; blur: number; dist: number; dir: number; alpha?: number };
  glow?: { color: Color; rad: number };
  softEdge?: number;
}

// ------------------------------------------------------------------------------------------
// Text

export interface RunProps {
  b?: boolean;
  i?: boolean;
  u?: boolean | 'dbl' | 'wavy';
  strike?: boolean | 'dbl';
  /** Points. */
  size?: number;
  font?: string;
  color?: Color;
  highlight?: Color;
  /** Percent of the font size: positive superscript, negative subscript. */
  baseline?: number;
  caps?: 'all' | 'small' | 'none';
  /** Tracking (character spacing) in points. */
  spc?: number;
  /** Baseline shift in points (positive raises), at full size; independent of superscript/subscript. */
  shift?: number;
  /** Horizontal scale of the glyphs, percent (100 = normal). */
  hscale?: number;
  /** Outline type: the glyphs are stroked in the text colour and filled with paper (white). */
  outline?: boolean;
  /** Shadow type: a copy of the glyphs offset down and right by about 1/12 of the size, in grey. */
  tshadow?: boolean;
  /** Kerning pairs on (default on). */
  kern?: boolean;
  /** Ligatures on (default on). */
  liga?: boolean;
  link?: string;
  lang?: string;
  /** Character style name (overrides stack on top of it). */
  cstyle?: string;
}

export interface Run extends RunProps {
  text: string;
  /** A field whose text holds the last displayed value. */
  field?: 'pagenum' | 'pagecount' | 'date' | 'time' | 'section' | 'title' | 'nextpage' | 'prevpage' | 'variable';
  /** Variable name for 'variable' fields. */
  varName?: string;
  /** A line break inside the paragraph. */
  br?: boolean;
  /**
   * Id of an item anchored at this run (the run's text is the object replacement character U+FFFC);
   * the layout engine positions the item next to the text.
   */
  anchor?: string;
  /** Id of a footnote (in the story's `footnotes`); the text holds the last displayed reference label. */
  footnote?: string;
}

export type BulletKind = 'none' | 'char' | 'num';
export type NumScheme = 'arabicPeriod' | 'arabicParenR' | 'arabicPlain' | 'alphaLcPeriod' | 'alphaUcPeriod' | 'alphaLcParenR' | 'romanLcPeriod' | 'romanUcPeriod';
export interface Bullet { kind: BulletKind; char?: string; scheme?: NumScheme; startAt?: number; font?: string; color?: Color; /** Percent of the text size. */ size?: number }

export interface Tab { pos: number; align: 'l' | 'ctr' | 'r' | 'dec'; leader?: string }

export interface ParaProps {
  align?: 'l' | 'ctr' | 'r' | 'just' | 'justAll';
  /** Left margin, points. */
  marL?: number;
  /** Right margin, points. */
  marR?: number;
  /** First-line indent relative to the left margin (negative = hanging). */
  indent?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  /** Leading: percent of the font size (lineSpacingPt false) or points (lineSpacingPt true). */
  lineSpacing?: number;
  lineSpacingPt?: boolean;
  bullet?: Bullet;
  /** Drop cap: number of lines and characters. */
  dropCap?: { lines: number; chars: number };
  keepWithNext?: boolean;
  keepLines?: boolean;
  hyphenate?: boolean;
  /** Snap baselines to the publication's baseline grid. */
  gridAlign?: boolean;
  /** Optical margin alignment: punctuation and open-sided glyphs hang outside the margins. */
  opticalMargin?: boolean;
  tabs?: Tab[];
  /** Rule above / below. */
  ruleAbove?: { width: number; color: Color; offset?: number };
  ruleBelow?: { width: number; color: Color; offset?: number };
  /** Paragraph style name. */
  style?: string;
}

export interface Paragraph extends ParaProps {
  runs: Run[];
  /** Formatting for text typed at the end of an empty paragraph. */
  end?: RunProps;
}

export interface ParaStyle extends ParaProps {
  name: string;
  /** Parent style name. */
  basedOn?: string;
  /** Style for the next paragraph typed. */
  next?: string;
  run?: RunProps;
}

export interface CharStyle extends RunProps {
  name: string;
  basedOn?: string;
}

export interface ObjectStyle {
  name: string;
  fill?: Fill;
  line?: Line;
  effects?: Effects;
  insets?: [number, number, number, number];
  columns?: number;
  gutter?: number;
}

export interface Footnote { id: string; paras: Paragraph[] }

export interface Story {
  id: string;
  paras: Paragraph[];
  /** Name shown in the Stories/Text Threads panes. */
  name?: string;
  /** Footnotes referenced by runs with `footnote` (set at the bottom of the column holding the reference). */
  footnotes?: Footnote[];
  /** Optical margin alignment for the whole story (a paragraph's own setting wins). */
  opticalMargin?: boolean;
}

export interface FootnoteOptions {
  /** Numbering scheme; 'symbols' cycles * † ‡ § ‖ ¶ (then doubled). */
  scheme: NumScheme | 'symbols';
  /** Numbering restarts per story or per page. */
  restart: 'story' | 'page';
  /** Separator rule: stroke width, length as a fraction of the column width, and space above it. */
  separator: { width: number; length: number; space: number };
  /** Paragraph style of footnote text. */
  style: string;
  /** Footnotes sit at the bottom of their column, or of the frame's first column. */
  placement: 'column' | 'frame';
}

export const DEFAULT_FOOTNOTE_OPTIONS: FootnoteOptions = { scheme: 'arabicPlain', restart: 'story', separator: { width: 0.5, length: 0.33, space: 6 }, style: 'Footnote', placement: 'column' };

// ------------------------------------------------------------------------------------------
// Items (frames)

export type WrapMode = 'none' | 'square' | 'tight' | 'topBottom' | 'behind';

export interface ItemBase {
  id: string;
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees, clockwise. */
  rot?: number;
  /** Horizontal skew in degrees about the item's centre (positive leans the top to the right). */
  skew?: number;
  flipH?: boolean;
  flipV?: boolean;
  locked?: boolean;
  hidden?: boolean;
  /** Layer id (undefined = the default layer). */
  layer?: string;
  /** Text wrap around this object for text frames beneath it. */
  wrap?: { mode: WrapMode; offset?: number };
  alt?: string;
  decorative?: boolean;
  link?: string;
  /** Object style name. */
  ostyle?: string;
  fill?: Fill;
  line?: Line;
  effects?: Effects;
  /** Opacity 0..1 of the whole object. */
  alpha?: number;
  /** Master page item that this page item overrides (id on the master). */
  masterOf?: string;
  tags?: Record<string, string>;
  /**
   * The item travels with the text of a story (an inline object, an object above its line, or one at
   * an offset from its anchor); x and y are then written by the layout, w and h stay authored.
   */
  anchored?: AnchorOptions;
}

export interface AnchorOptions {
  story: string;
  mode: 'inline' | 'above' | 'custom';
  /** Offset from the anchor point (custom), or from the paragraph's left (above). */
  dx?: number;
  dy?: number;
  /** Horizontal alignment of an object above its line. */
  align?: 'l' | 'ctr' | 'r';
  /** Vertical alignment of an inline object on its line. */
  valign?: 'baseline' | 'ctr' | 'top';
}

export interface TextFrame extends ItemBase {
  kind: 'text';
  /** Story shown in this frame (frames of one story form a chain). */
  story: string;
  /** Previous / next frame in the story chain. */
  prev?: string;
  next?: string;
  columns?: number;
  gutter?: number;
  insets?: [number, number, number, number];
  anchor?: 't' | 'ctr' | 'b' | 'just';
  /** Shape of the frame (preset geometry; text is laid out in its rectangle). */
  geom?: string;
  /** Grow the frame to fit its text (height). */
  autosize?: 'none' | 'height';
  /** Vertical text (rotated 90° reading). */
  vertical?: boolean;
  /** Text inside the frame ignores wrap from objects above. */
  ignoreWrap?: boolean;
  /** First baseline offset. */
  firstBaseline?: 'ascent' | 'leading' | 'capHeight';
}

export interface PictureFrame extends ItemBase {
  kind: 'picture';
  /** Media id (undefined = empty placeholder frame). */
  media?: string;
  /** Crop fractions of the source picture [l, t, r, b]. */
  crop?: [number, number, number, number];
  /** How the picture fills the frame. */
  fit?: 'fill' | 'fit' | 'stretch' | 'none' | 'tile';
  /** Picture offset and scale inside the frame for fit 'none'. */
  pos?: { x: number; y: number; scale: number };
  geom?: string;
  /** Adjustments. */
  brightness?: number;
  contrast?: number;
  saturation?: number;
  grayscale?: boolean;
  /** Source information for the Links pane. */
  src?: string;
}

export interface ShapeItem extends ItemBase {
  kind: 'shape';
  geom: string;
  adj?: Record<string, number>;
  path?: { d: string; w: number; h: number }[];
}

export interface LineItem extends ItemBase {
  kind: 'line';
}

export interface TableCell { text: Paragraph[]; fill?: Fill; colSpan?: number; rowSpan?: number; merged?: boolean; insets?: [number, number, number, number]; anchor?: 't' | 'ctr' | 'b' }
export interface TableRow { h: number; cells: TableCell[]; header?: boolean }
export interface TableItem extends ItemBase {
  kind: 'table';
  cols: number[];
  rows: TableRow[];
  border?: Line;
  innerBorder?: Line;
  style?: { firstRow?: boolean; bandedRows?: boolean; firstCol?: boolean; bandColor?: Color; headerFill?: Fill };
  /** Footnotes referenced from the cells; set in a note area under the rows, numbered per table in reading order. */
  footnotes?: Footnote[];
}

export interface GroupItem extends ItemBase {
  kind: 'group';
  children: Item[];
}

/** Text set along a path (the path is drawn in a local box and scaled to the item's box). */
export interface PathTextItem extends ItemBase {
  kind: 'pathText';
  path: { d: string; w: number; h: number };
  /** One paragraph normally; several are joined with spaces. */
  text: Paragraph[];
  align: 'start' | 'center' | 'end' | 'justify';
  /** Start offset along the path, points. */
  offset: number;
  /** Perpendicular shift from the path, points (negative = the other side). */
  baseline: number;
  /** Set the text on the other side, running the other way. */
  flip?: boolean;
  /** Extra tracking between characters, points. */
  spacing?: number;
  /** Draw the path with the item's outline. */
  showPath?: boolean;
  /** Preset name the path was made from (line, arcUp, arcDown, circle, wave, zigzag, shape). */
  preset?: string;
  /** Footnotes referenced from the text; set in a note area below the item's box. */
  footnotes?: Footnote[];
}

export type Item = TextFrame | PictureFrame | ShapeItem | LineItem | TableItem | GroupItem | PathTextItem;

// ------------------------------------------------------------------------------------------
// Pages

export interface Guide { pos: number; dir: 'h' | 'v'; locked?: boolean }

export interface PageGeometry {
  /** Margins: top, right, bottom, left (inside margin = left on right-hand pages when facing). */
  margins: [number, number, number, number];
  columns: number;
  gutter: number;
}

export interface Master extends PageGeometry {
  id: string;
  /** A-Master, B-Master… */
  name: string;
  items: Item[];
  guides?: Guide[];
  /** Facing masters: 'left' | 'right' | 'single'. */
  side?: 'single' | 'left' | 'right';
  basedOn?: string;
}

export interface Page {
  id: string;
  master: string;
  items: Item[];
  /** A name shown in the Pages pane and Navigator (optional). */
  name?: string;
  /** Section-aware label ("iv", "12") recomputed on change; stored for exports. */
  label?: string;
  guides?: Guide[];
  /** Overrides of this page's margins/columns (otherwise the master's). */
  margins?: [number, number, number, number];
  columns?: number;
  gutter?: number;
  /** Master items hidden on this page. */
  hideMasterItems?: boolean;
  notes?: string;
  bg?: Fill;
  comments?: Comment[];
}

export interface Section { id: string; name: string; /** Index of the first page. */ start: number; numbering: NumScheme | 'none'; startAt: number; prefix?: string }

export interface Layer { id: string; name: string; hidden?: boolean; locked?: boolean; color?: string }

export interface Swatch { name: string; color: Color; /** CMYK values 0..100 when defined by the user as process color. */ cmyk?: [number, number, number, number]; spot?: boolean }

export interface Comment { id: string; author: string; text: string; when: number; x: number; y: number; resolved?: boolean; replies?: { author: string; text: string; when: number }[] }

export interface Variable { name: string; value: string }

export interface DocProps { title?: string; author?: string; subject?: string; keywords?: string; description?: string; created?: number; modified?: number; lastModifiedBy?: string; custom?: Record<string, string>; language?: string }

export interface Publication {
  /** Page size in points. */
  size: { w: number; h: number };
  facing: boolean;
  /** Bleed on each side, points. */
  bleed: number;
  pages: Page[];
  masters: Master[];
  stories: Story[];
  styles: { para: ParaStyle[]; char: CharStyle[]; object: ObjectStyle[] };
  swatches: Swatch[];
  layers: Layer[];
  sections: Section[];
  variables: Variable[];
  /** Baseline grid: start offset and spacing (points); 0 = off. */
  baselineGrid: { start: number; step: number; show?: boolean };
  /** Unit shown in rulers and dialogs. */
  unit: 'in' | 'mm' | 'cm' | 'pt' | 'pica' | 'px';
  props: DocProps;
  /** Colors and fonts schemes (named presets). */
  scheme?: { colors?: string; fonts?: string };
  finalMarked?: boolean;
  /** Document-level Quick Access Bar additions. */
  qat?: string[];
  /** Footnote numbering and placement. */
  footnoteOptions?: FootnoteOptions;
  /** Reference size (points) that scales the optical margin overhang; default 12. */
  opticalMarginSize?: number;
}

export interface MediaItem { mime: string; b64: string; name?: string; w?: number; h?: number; dpi?: number }

export type PageSizeDef = { id: string; label: string; w: number; h: number };

export const PAGE_SIZES: PageSizeDef[] = [
  { id: 'letter', label: 'Letter (8.5 × 11 in)', w: 612, h: 792 },
  { id: 'legal', label: 'Legal (8.5 × 14 in)', w: 612, h: 1008 },
  { id: 'tabloid', label: 'Tabloid (11 × 17 in)', w: 792, h: 1224 },
  { id: 'a3', label: 'A3 (297 × 420 mm)', w: 841.89, h: 1190.55 },
  { id: 'a4', label: 'A4 (210 × 297 mm)', w: 595.28, h: 841.89 },
  { id: 'a5', label: 'A5 (148 × 210 mm)', w: 419.53, h: 595.28 },
  { id: 'a6', label: 'A6 (105 × 148 mm)', w: 297.64, h: 419.53 },
  { id: 'b5', label: 'B5 (176 × 250 mm)', w: 498.9, h: 708.66 },
  { id: 'postcard', label: 'Postcard (4 × 6 in)', w: 288, h: 432 },
  { id: 'card', label: 'Business Card (3.5 × 2 in)', w: 252, h: 144 },
  { id: 'trifold', label: 'Trifold Brochure (11 × 8.5 in)', w: 792, h: 612 },
  { id: 'poster18', label: 'Poster (18 × 24 in)', w: 1296, h: 1728 },
  { id: 'poster24', label: 'Poster (24 × 36 in)', w: 1728, h: 2592 },
  { id: 'square', label: 'Square (8 × 8 in)', w: 576, h: 576 },
  { id: 'screen', label: 'Screen (1920 × 1080 px)', w: 1440, h: 810 },
];

export const UNITS: Record<Publication['unit'], { label: string; pt: number; digits: number }> = {
  in: { label: 'in', pt: 72, digits: 3 },
  mm: { label: 'mm', pt: 72 / 25.4, digits: 1 },
  cm: { label: 'cm', pt: 72 / 2.54, digits: 2 },
  pt: { label: 'pt', pt: 1, digits: 1 },
  pica: { label: 'p', pt: 12, digits: 2 },
  px: { label: 'px', pt: 0.75, digits: 0 },
};
