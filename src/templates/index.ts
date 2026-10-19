/**
 * Templates: original starting points built in code from the default styles (no copied artwork).
 * Each builds a complete publication with masters, frames and placeholder text.
 */
import { Pub, newId } from '../model/pub';
import type { Fill, Item, Master, Page, Paragraph, PictureFrame, ShapeItem, TextFrame } from '../model/types';
import { PAGE_SIZES } from '../model/types';
import { COLOR_SCHEMES, FONT_SCHEMES, applyColorScheme, applyFontScheme } from '../model/styles';
import { LOREM } from './lorem';

export interface Template { id: string; name: string; category: string; description: string; icon?: string; build: () => Pub }

const size = (id: string) => { const s = PAGE_SIZES.find((x) => x.id === id)!; return { w: s.w, h: s.h }; };
const land = (s: { w: number; h: number }) => ({ w: Math.max(s.w, s.h), h: Math.min(s.w, s.h) });
const para = (text: string, style = 'Body'): Paragraph => ({ style, runs: text ? [{ text }] : [] });

function text(pub: Pub, page: { items: Item[] }, box: { x: number; y: number; w: number; h: number }, paras: Paragraph[], o: Partial<TextFrame> = {}): TextFrame {
  const f = pub.newTextFrame(box, paras);
  Object.assign(f, { insets: [0, 0, 0, 0] }, o);
  page.items.push(f);
  return f;
}

function pic(page: { items: Item[] }, box: { x: number; y: number; w: number; h: number }, o: Partial<PictureFrame> = {}): PictureFrame {
  const p: PictureFrame = { id: newId('pic'), kind: 'picture', name: 'Picture', ...box, fit: 'fill', line: { fill: { type: 'solid', color: 'Gray' }, width: 0.5, dash: 'dash' }, ...o };
  page.items.push(p);
  return p;
}

function shape(page: { items: Item[] }, box: { x: number; y: number; w: number; h: number }, fill: Fill, o: Partial<ShapeItem> = {}): ShapeItem {
  const s: ShapeItem = { id: newId('sh'), kind: 'shape', geom: 'rect', name: 'Decoration', ...box, fill, line: { fill: { type: 'none' } }, ...o };
  page.items.push(s);
  return s;
}

function folio(pub: Pub, m: Master, opts: { title?: string; side?: 'in' | 'out' } = {}): void {
  const { w, h } = pub.size;
  const [, mr, mb, ml] = m.margins;
  text(pub, m, { x: ml, y: h - mb + 10, w: w - ml - mr, h: 14 }, [{ style: 'Folio', align: opts.side === 'out' ? 'r' : 'l', runs: [{ text: '1', field: 'pagenum' }, ...(opts.title ? [{ text: `  ·  ${opts.title}` }] : [])] }], { name: 'Folio' });
}

function base(sizeId: string, o: { landscape?: boolean; facing?: boolean; margins?: [number, number, number, number]; columns?: number; pages?: number; colors?: string; fonts?: string; bleed?: number } = {}): Pub {
  const s = o.landscape ? land(size(sizeId)) : size(sizeId);
  const pub = Pub.blank(s, { facing: o.facing, margins: o.margins || [36, 36, 36, 36], columns: o.columns || 1, pages: o.pages || 1 });
  if (o.colors) { const c = COLOR_SCHEMES.find((x) => x.name === o.colors); if (c) applyColorScheme(pub.data, c); }
  if (o.fonts) { const f = FONT_SCHEMES.find((x) => x.name === o.fonts); if (f) applyFontScheme(pub.data, f); }
  if (o.bleed) pub.data.bleed = o.bleed;
  return pub;
}

const body = (n: number, from = 0) => LOREM.slice(from, from + n).map((t, i) => para(t, i === 0 ? 'Body First' : 'Body'));

export const TEMPLATES: Template[] = [
  { id: 'blank', name: 'Blank', category: 'Basic', description: 'Letter, one column, 0.5 in margins', icon: 'crop_portrait', build: () => base('letter') },
  {
    id: 'newsletter', name: 'Newsletter', category: 'Newsletters', description: 'Four pages, three columns, nameplate, sidebars and pull quotes', icon: 'newspaper',
    build: () => {
      const pub = base('letter', { facing: true, margins: [48, 36, 48, 36], columns: 3, pages: 4, colors: 'Violet', fonts: 'Classic' });
      const { w, h } = pub.size;
      const m = pub.data.masters[0];
      const [mt, mr, mb, ml] = m.margins;
      folio(pub, m, { title: 'Newsletter' });
      shape(m, { x: 0, y: 0, w, h: 6 }, { type: 'solid', color: 'Primary' });
      const [p1, p2, p3, p4] = pub.pages;
      const cw = (w - ml - mr - 2 * m.gutter) / 3;
      // Page 1: nameplate, lead story, sidebar
      shape(p1, { x: 0, y: 0, w, h: 110 }, { type: 'solid', color: 'Primary' }, { name: 'Nameplate band' });
      text(pub, p1, { x: ml, y: 30, w: w - ml - mr, h: 54 }, [{ style: 'Headline', align: 'l', runs: [{ text: 'THE QUILL', color: 'White', size: 44 }] }], { name: 'Nameplate' });
      text(pub, p1, { x: ml, y: 84, w: w - ml - mr, h: 16 }, [{ style: 'Folio', runs: [{ text: 'Volume 1 · Issue 1 · ', color: 'White' }, { text: 'October 2026', field: 'date', color: 'White' }] }], { name: 'Dateline' });
      text(pub, p1, { x: ml, y: 130, w: cw * 2 + m.gutter, h: 60 }, [para('A headline that tells the story', 'Heading 1'), para('The deck adds a line of context under the headline.', 'Deck')], { name: 'Lead headline', autosize: 'height' });
      pic(p1, { x: ml, y: 200, w: cw * 2 + m.gutter, h: 150 });
      text(pub, p1, { x: ml, y: 354, w: cw * 2 + m.gutter, h: 16 }, [para('Caption: say what the picture shows and who made it.', 'Caption')], { name: 'Caption', autosize: 'height' });
      const lead = text(pub, p1, { x: ml, y: 380, w: cw * 2 + m.gutter, h: h - mb - 380 }, [para('By A. Writer', 'Byline'), ...body(4)], { name: 'Lead story', columns: 2, gutter: m.gutter });
      text(pub, p1, { x: ml + 2 * (cw + m.gutter), y: 130, w: cw, h: h - mb - 130 }, [para('In this issue', 'Subhead'), para('The lead story', 'Bullet List'), para('News in brief', 'Bullet List'), para('Calendar', 'Bullet List'), para('Contact us', 'Bullet List'), para('', 'Body'), para('Contact', 'Subhead'), para('editor@example.org', 'Contact'), para('+1 555 0100', 'Contact')], { name: 'Sidebar', ostyle: 'Sidebar', insets: [9, 9, 9, 9] });
      // Page 2–3: continued story and briefs
      const cont = text(pub, p2, { x: mr, y: mt, w: w - ml - mr, h: h - mt - mb }, [], { name: 'Lead story (continued)', columns: 3, gutter: m.gutter });
      cont.story = lead.story; cont.prev = lead.id; lead.next = cont.id; pub.pruneStories();
      text(pub, p3, { x: ml, y: mt, w: w - ml - mr, h: 40 }, [para('News in brief', 'Heading 1')], { name: 'Briefs head', autosize: 'height' });
      text(pub, p3, { x: ml, y: mt + 48, w: w - ml - mr, h: h - mt - mb - 48 }, [para('First item', 'Heading 3'), para(LOREM[2]), para('Second item', 'Heading 3'), para(LOREM[3]), para('Third item', 'Heading 3'), para(LOREM[4])], { name: 'Briefs', columns: 3, gutter: m.gutter });
      const pq = text(pub, p3, { x: ml + cw + m.gutter, y: h / 2, w: cw, h: 100 }, [{ style: 'Pull Quote', ruleAbove: { width: 2, color: 'Primary' }, ruleBelow: { width: 2, color: 'Primary' }, runs: [{ text: '“A pull quote draws the reader into the story.”' }] }], { name: 'Pull quote', wrap: { mode: 'square', offset: 9 }, insets: [6, 0, 6, 0] });
      pq.autosize = 'height';
      // Page 4: calendar and contact
      text(pub, p4, { x: mr, y: mt, w: w - ml - mr, h: 40 }, [para('Calendar', 'Heading 1')], { name: 'Calendar head', autosize: 'height' });
      text(pub, p4, { x: mr, y: mt + 48, w: cw * 2 + m.gutter, h: 300 }, [{ style: 'Body No Indent', tabs: [{ pos: 80, align: 'l' }], runs: [{ text: 'Oct 24\tOpen house' }] }, { style: 'Body No Indent', tabs: [{ pos: 80, align: 'l' }], runs: [{ text: 'Nov 2\tBoard meeting' }] }, { style: 'Body No Indent', tabs: [{ pos: 80, align: 'l' }], runs: [{ text: 'Nov 15\tFall social' }] }], { name: 'Calendar' });
      text(pub, p4, { x: mr + 2 * (cw + m.gutter), y: mt + 48, w: cw, h: 200 }, [para('About us', 'Subhead'), para(LOREM[5], 'Body No Indent')], { name: 'About', ostyle: 'Sidebar', insets: [9, 9, 9, 9] });
      pub.data.props.title = 'Newsletter';
      pub.data.sections = [];
      return pub;
    },
  },
  {
    id: 'brochure', name: 'Trifold Brochure', category: 'Brochures', description: 'Letter landscape, two pages of three panels each (outside and inside)', icon: 'view_week',
    build: () => {
      const pub = base('trifold', { margins: [36, 24, 36, 24], pages: 2, colors: 'Ocean', fonts: 'Modern', bleed: 9 });
      const { w, h } = pub.size;
      const m = pub.data.masters[0];
      const pw = w / 3;
      m.guides = [{ pos: pw, dir: 'v', locked: true }, { pos: 2 * pw, dir: 'v', locked: true }];
      m.columns = 1;
      const [outside, inside] = pub.pages;
      outside.name = 'Outside (back, flap, front)'; inside.name = 'Inside';
      // Front panel (right third of the outside)
      shape(outside, { x: 2 * pw, y: 0, w: pw, h }, { type: 'solid', color: 'Primary' }, { name: 'Front background' });
      text(pub, outside, { x: 2 * pw + 24, y: h * 0.3, w: pw - 48, h: 120 }, [{ style: 'Headline', runs: [{ text: 'Your Title Here', color: 'White', size: 34 }] }, { style: 'Deck', runs: [{ text: 'A tagline that says what you offer', color: 'White' }] }], { name: 'Front title' });
      text(pub, outside, { x: 2 * pw + 24, y: h - 70, w: pw - 48, h: 40 }, [{ style: 'Contact', runs: [{ text: 'www.example.org', color: 'White' }] }], { name: 'Front web' });
      // Flap (middle) and back (left)
      text(pub, outside, { x: pw + 24, y: 36, w: pw - 48, h: h - 72 }, [para('About us', 'Heading 2'), ...body(2, 4)], { name: 'Flap' });
      text(pub, outside, { x: 24, y: 36, w: pw - 48, h: h - 72 }, [para('Contact', 'Heading 2'), para('Organization name', 'Body No Indent'), para('123 Main Street', 'Contact'), para('City, State 00000', 'Contact'), para('+1 555 0100', 'Contact'), para('hello@example.org', 'Contact')], { name: 'Back' });
      // Inside: three panels
      for (let i = 0; i < 3; i++) {
        text(pub, inside, { x: i * pw + 24, y: 36, w: pw - 48, h: 30 }, [para(['What we do', 'How it works', 'Get started'][i], 'Heading 2')], { name: `Panel ${i + 1} head`, autosize: 'height' });
        pic(inside, { x: i * pw + 24, y: 72, w: pw - 48, h: 110 });
        text(pub, inside, { x: i * pw + 24, y: 192, w: pw - 48, h: h - 228 }, body(2, i * 2), { name: `Panel ${i + 1}` });
      }
      pub.data.props.title = 'Brochure';
      return pub;
    },
  },
  {
    id: 'flyer', name: 'Flyer', category: 'Flyers', description: 'One page: big headline, picture, details and a call to action', icon: 'campaign',
    build: () => {
      const pub = base('letter', { margins: [36, 36, 36, 36], colors: 'Ember', fonts: 'Friendly', bleed: 9 });
      const { w, h } = pub.size;
      const p = pub.pages[0];
      shape(p, { x: -9, y: -9, w: w + 18, h: 200 }, { type: 'solid', color: 'Primary' }, { name: 'Header band' });
      text(pub, p, { x: 36, y: 50, w: w - 72, h: 120 }, [{ style: 'Headline', align: 'ctr', runs: [{ text: 'BIG EVENT', color: 'White', size: 60 }] }, { style: 'Deck', align: 'ctr', runs: [{ text: 'Saturday, November 15 · 10 a.m. to 4 p.m.', color: 'White' }] }], { name: 'Headline' });
      pic(p, { x: 36, y: 220, w: w - 72, h: 260 });
      text(pub, p, { x: 36, y: 500, w: w - 72, h: 160 }, [{ style: 'Heading 2', align: 'ctr', runs: [{ text: 'Everyone is welcome' }] }, { style: 'Body No Indent', align: 'ctr', runs: [{ text: LOREM[0] }] }], { name: 'Details' });
      shape(p, { x: w / 2 - 120, y: 680, w: 240, h: 54 }, { type: 'solid', color: 'Secondary' }, { geom: 'roundRect', name: 'Button' });
      text(pub, p, { x: w / 2 - 120, y: 680, w: 240, h: 54 }, [{ style: 'Heading 3', align: 'ctr', runs: [{ text: 'example.org/event', color: 'White' }] }], { name: 'Call to action', anchor: 'ctr' });
      pub.data.props.title = 'Flyer';
      return pub;
    },
  },
  {
    id: 'poster', name: 'Poster', category: 'Posters', description: '18 × 24 in, one large picture and three lines of type', icon: 'wallpaper',
    build: () => {
      const pub = base('poster18', { margins: [72, 72, 72, 72], colors: 'Slate', fonts: 'Contrast', bleed: 18 });
      const { w, h } = pub.size;
      const p = pub.pages[0];
      shape(p, { x: -18, y: -18, w: w + 36, h: h + 36 }, { type: 'solid', color: 'Primary' }, { name: 'Background' });
      pic(p, { x: 72, y: 72, w: w - 144, h: h * 0.55 });
      text(pub, p, { x: 72, y: h * 0.55 + 100, w: w - 144, h: 300 }, [{ style: 'Headline', runs: [{ text: 'Poster Title', color: 'White', size: 96 }] }, { style: 'Deck', runs: [{ text: 'A second line in a lighter voice', color: 'White', size: 36 }] }], { name: 'Title' });
      text(pub, p, { x: 72, y: h - 160, w: w - 144, h: 60 }, [{ style: 'Contact', runs: [{ text: 'Date · Place · example.org', color: 'White', size: 24 }] }], { name: 'Details' });
      pub.data.props.title = 'Poster';
      return pub;
    },
  },
  {
    id: 'businessCard', name: 'Business Card', category: 'Cards', description: '3.5 × 2 in with bleed; front and back pages', icon: 'badge',
    build: () => {
      const pub = base('card', { margins: [14, 14, 14, 14], pages: 2, colors: 'Violet', fonts: 'Modern', bleed: 9 });
      const { w, h } = pub.size;
      const [front, back] = pub.pages;
      front.name = 'Front'; back.name = 'Back';
      shape(front, { x: -9, y: -9, w: 60, h: h + 18 }, { type: 'solid', color: 'Primary' }, { name: 'Band' });
      text(pub, front, { x: 66, y: 24, w: w - 80, h: 50 }, [{ style: 'Heading 2', runs: [{ text: 'Firstname Lastname' }] }, { style: 'Caption', runs: [{ text: 'Title · Organization' }] }], { name: 'Name' });
      text(pub, front, { x: 66, y: 84, w: w - 80, h: 50 }, [para('+1 555 0100', 'Contact'), para('name@example.org', 'Contact'), para('example.org', 'Contact')], { name: 'Contact' });
      shape(back, { x: -9, y: -9, w: w + 18, h: h + 18 }, { type: 'solid', color: 'Primary' }, { name: 'Background' });
      text(pub, back, { x: 14, y: 14, w: w - 28, h: h - 28 }, [{ style: 'Headline', align: 'ctr', runs: [{ text: 'LOGO', color: 'White', size: 28 }] }], { name: 'Logo', anchor: 'ctr' });
      pub.data.props.title = 'Business Card';
      return pub;
    },
  },
  {
    id: 'invoice', name: 'Invoice', category: 'Business', description: 'Letter: header, addresses, items table, totals and terms', icon: 'receipt_long',
    build: () => {
      const pub = base('letter', { margins: [54, 54, 54, 54], colors: 'Mono', fonts: 'Office' });
      const { w } = pub.size;
      const p = pub.pages[0];
      text(pub, p, { x: 54, y: 54, w: 300, h: 60 }, [{ style: 'Heading 1', runs: [{ text: 'Your Company' }] }, para('123 Main Street, City, State 00000', 'Contact'), para('billing@example.org · +1 555 0100', 'Contact')], { name: 'From' });
      text(pub, p, { x: w - 54 - 180, y: 54, w: 180, h: 70 }, [{ style: 'Headline', align: 'r', runs: [{ text: 'INVOICE', size: 28 }] }, { style: 'Body No Indent', align: 'r', runs: [{ text: 'No. 2026-001' }] }, { style: 'Body No Indent', align: 'r', runs: [{ text: 'Date: ' }, { text: 'October 19, 2026', field: 'date' }] }], { name: 'Invoice number' });
      text(pub, p, { x: 54, y: 150, w: 240, h: 70 }, [para('Bill to', 'Subhead'), para('Client name', 'Body No Indent'), para('Client address', 'Contact')], { name: 'Bill to' });
      const cols = [260, 70, 86, 88];
      const rows = [['Description', 'Qty', 'Unit price', 'Amount'], ['Design work', '10', '$80.00', '$800.00'], ['Printing', '1', '$250.00', '$250.00'], ['', '', '', ''], ['', '', 'Subtotal', '$1,050.00'], ['', '', 'Tax (8%)', '$84.00'], ['', '', 'Total', '$1,134.00']];
      p.items.push({ id: newId('tbl'), kind: 'table', name: 'Items', x: 54, y: 240, w: cols.reduce((a, b) => a + b, 0), h: 22 * rows.length, cols, rows: rows.map((r, i) => ({ h: 22, header: i === 0, cells: r.map((t, c) => ({ text: [{ style: i === 0 ? 'Table Header' : 'Table Text', align: c > 0 ? 'r' : 'l', runs: t ? [{ text: t, b: i >= 4 && c === 3 ? true : undefined }] : [] }] })) })), border: { fill: { type: 'solid', color: 'Black' }, width: 0.5 }, innerBorder: { fill: { type: 'solid', color: 'Light Gray' }, width: 0.5 }, style: { firstRow: true, headerFill: { type: 'solid', color: 'Light Gray' } } });
      text(pub, p, { x: 54, y: 440, w: w - 108, h: 80 }, [para('Terms', 'Subhead'), para('Payment is due within 30 days. Thank you for your business.', 'Body No Indent')], { name: 'Terms' });
      pub.data.props.title = 'Invoice';
      return pub;
    },
  },
  {
    id: 'menu', name: 'Menu', category: 'Menus', description: 'Letter: two columns of dishes with dot leaders to prices', icon: 'restaurant_menu',
    build: () => {
      const pub = base('letter', { margins: [54, 54, 54, 54], columns: 2, colors: 'Forest', fonts: 'Editorial' });
      const { w, h } = pub.size;
      const p = pub.pages[0];
      shape(p, { x: 36, y: 36, w: w - 72, h: h - 72 }, { type: 'none' }, { name: 'Frame', line: { fill: { type: 'solid', color: 'Primary' }, width: 1.5 } });
      text(pub, p, { x: 54, y: 60, w: w - 108, h: 70 }, [{ style: 'Headline', align: 'ctr', runs: [{ text: 'The Corner Table' }] }, { style: 'Deck', align: 'ctr', runs: [{ text: 'Seasonal dishes · Served daily from noon' }] }], { name: 'Title' });
      const item = (name: string, price: string, desc: string): Paragraph[] => [{ style: 'Body No Indent', tabs: [{ pos: (w - 108 - 24) / 2, align: 'r', leader: '.' }], runs: [{ text: name, b: true }, { text: '\t' + price }] }, para(desc, 'Caption')];
      text(pub, p, { x: 54, y: 150, w: w - 108, h: h - 240 }, [para('Starters', 'Heading 2'), ...item('Soup of the day', '8', 'With bread from the oven'), ...item('Garden salad', '9', 'Leaves, herbs, lemon dressing'), para('Mains', 'Heading 2'), ...item('Roast chicken', '18', 'Root vegetables, pan juices'), ...item('Mushroom risotto', '16', 'Parmesan, thyme'), ...item('Grilled fish', '21', 'Greens, salsa verde'), para('Desserts', 'Heading 2'), ...item('Apple tart', '7', 'Vanilla cream'), ...item('Dark chocolate cake', '8', 'Sea salt')], { name: 'Menu', columns: 2, gutter: 24 });
      pub.data.props.title = 'Menu';
      return pub;
    },
  },
  {
    id: 'resume', name: 'Résumé', category: 'Business', description: 'Letter: name block, summary, experience and education', icon: 'person',
    build: () => {
      const pub = base('letter', { margins: [54, 54, 54, 54], colors: 'Slate', fonts: 'Modern' });
      const { w, h } = pub.size;
      const p = pub.pages[0];
      text(pub, p, { x: 54, y: 54, w: w - 108, h: 70 }, [{ style: 'Headline', runs: [{ text: 'Firstname Lastname', size: 30 }] }, para('City, State · +1 555 0100 · name@example.org · example.org', 'Contact')], { name: 'Name' });
      shape(p, { x: 54, y: 128, w: w - 108, h: 1.5 }, { type: 'solid', color: 'Primary' }, { name: 'Rule' });
      text(pub, p, { x: 54, y: 140, w: w - 108, h: h - 200 }, [para('Summary', 'Heading 2'), para(LOREM[5], 'Body No Indent'), para('Experience', 'Heading 2'), para('Job Title, Organization — 2022 to present', 'Heading 3'), para('What you did and achieved, with a number.', 'Bullet List'), para('Another result.', 'Bullet List'), para('Earlier Title, Organization — 2018 to 2022', 'Heading 3'), para('What you did and achieved.', 'Bullet List'), para('Education', 'Heading 2'), para('Degree, Institution — 2018', 'Heading 3'), para('Skills', 'Heading 2'), para('Page layout, typography, editing, project management', 'Body No Indent')], { name: 'Résumé' });
      pub.data.props.title = 'Résumé';
      return pub;
    },
  },
  {
    id: 'booklet', name: 'Booklet', category: 'Books', description: 'A5 facing pages, eight pages, running heads and folios on left and right masters', icon: 'menu_book',
    build: () => {
      const pub = base('a5', { facing: true, margins: [48, 36, 54, 48], pages: 8, colors: 'Mono', fonts: 'Literary' });
      const { w, h } = pub.size;
      const m = pub.data.masters[0];
      m.name = 'A-Master'; m.side = 'single';
      const [mt, mr, mb, ml] = m.margins;
      text(pub, m, { x: ml, y: mt - 24, w: w - ml - mr, h: 14 }, [{ style: 'Folio', align: 'ctr', runs: [{ text: 'Booklet title', field: 'title' }] }], { name: 'Running head' });
      text(pub, m, { x: ml, y: h - mb + 14, w: w - ml - mr, h: 14 }, [{ style: 'Folio', align: 'ctr', runs: [{ text: '1', field: 'pagenum' }] }], { name: 'Folio' });
      const [cover, , , p4] = pub.pages;
      cover.hideMasterItems = true; cover.name = 'Cover';
      text(pub, cover, { x: ml, y: h * 0.35, w: w - ml - mr, h: 120 }, [{ style: 'Headline', align: 'ctr', runs: [{ text: 'Booklet Title' }] }, { style: 'Deck', align: 'ctr', runs: [{ text: 'Subtitle or author' }] }], { name: 'Cover title' });
      const first = text(pub, pub.pages[2], { x: ml, y: mt, w: w - ml - mr, h: h - mt - mb }, [para('Chapter One', 'Heading 1'), ...body(8)], { name: 'Chapter 1' });
      const cont = text(pub, p4, { x: mr, y: mt, w: w - ml - mr, h: h - mt - mb }, [], { name: 'Chapter 1 (continued)' });
      cont.story = first.story; cont.prev = first.id; first.next = cont.id; pub.pruneStories();
      pub.data.sections = [{ id: newId('sec'), name: 'Front matter', start: 0, numbering: 'romanLcPeriod', startAt: 1 }, { id: newId('sec'), name: 'Body', start: 2, numbering: 'arabicPlain', startAt: 1 }];
      pub.data.props.title = 'Booklet';
      pub.data.baselineGrid = { start: mt, step: 14 };
      return pub;
    },
  },
  {
    id: 'postcard', name: 'Postcard', category: 'Cards', description: '4 × 6 in: picture front, message and address back', icon: 'mail',
    build: () => {
      const pub = base('postcard', { landscape: true, margins: [18, 18, 18, 18], pages: 2, colors: 'Citrus', fonts: 'Friendly', bleed: 9 });
      const { w, h } = pub.size;
      const [front, back] = pub.pages;
      front.name = 'Front'; back.name = 'Back';
      pic(front, { x: -9, y: -9, w: w + 18, h: h + 18 });
      text(pub, front, { x: 24, y: h - 80, w: w - 48, h: 50 }, [{ style: 'Headline', runs: [{ text: 'Greetings from…', color: 'White', size: 30 }] }], { name: 'Greeting' });
      text(pub, back, { x: 18, y: 18, w: w / 2 - 30, h: h - 36 }, [para('Write your message here.', 'Body No Indent')], { name: 'Message' });
      shape(back, { x: w / 2, y: 18, w: 0.5, h: h - 36 }, { type: 'solid', color: 'Gray' }, { name: 'Divider' });
      shape(back, { x: w - 70, y: 18, w: 52, h: 60 }, { type: 'none' }, { name: 'Stamp', line: { fill: { type: 'solid', color: 'Gray' }, width: 0.5, dash: 'dash' } });
      text(pub, back, { x: w / 2 + 18, y: h / 2, w: w / 2 - 36, h: 80 }, [para('Name', 'Body No Indent'), para('Street', 'Body No Indent'), para('City, State 00000', 'Body No Indent')], { name: 'Address' });
      pub.data.props.title = 'Postcard';
      return pub;
    },
  },
  {
    id: 'report', name: 'Report', category: 'Documents', description: 'A4, single column with wide outside margin for notes and captions, cover and contents', icon: 'description',
    build: () => {
      const pub = base('a4', { margins: [64, 150, 72, 56], pages: 3, colors: 'Ocean', fonts: 'Classic' });
      const { w, h } = pub.size;
      const m = pub.data.masters[0];
      folio(pub, m, { side: 'out' });
      const [cover, contents, p3] = pub.pages;
      cover.hideMasterItems = true; cover.name = 'Cover'; contents.name = 'Contents';
      shape(cover, { x: 0, y: 0, w: 28, h }, { type: 'solid', color: 'Primary' }, { name: 'Band' });
      text(pub, cover, { x: 70, y: h * 0.3, w: w - 140, h: 160 }, [{ style: 'Headline', runs: [{ text: 'Report Title' }] }, { style: 'Deck', runs: [{ text: 'Subtitle · Prepared for whom · ' }, { text: 'October 2026', field: 'date' }] }], { name: 'Cover title' });
      text(pub, contents, { x: 56, y: 64, w: w - 206, h: 300 }, [para('Contents', 'Heading 1'), { style: 'Body No Indent', tabs: [{ pos: w - 206 - 2, align: 'r', leader: '.' }], runs: [{ text: 'Introduction\t3' }] }, { style: 'Body No Indent', tabs: [{ pos: w - 206 - 2, align: 'r', leader: '.' }], runs: [{ text: 'Findings\t3' }] }], { name: 'Contents' });
      text(pub, p3, { x: 56, y: 64, w: w - 206, h: h - 136 }, [para('Introduction', 'Heading 1'), ...body(3), para('Findings', 'Heading 2'), ...body(3, 3)], { name: 'Body' });
      text(pub, p3, { x: w - 140, y: 64, w: 100, h: 120 }, [para('Margin notes and figure captions go in the wide outside margin.', 'Caption')], { name: 'Margin note' });
      pub.data.props.title = 'Report';
      return pub;
    },
  },
];

export const templateById = (id: string): Template | undefined => TEMPLATES.find((t) => t.id === id);
