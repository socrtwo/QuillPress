import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { Pub, parasFromText, textOf } from '../../src/model/pub';
import type { TableItem } from '../../src/model/types';
import { importPublication, exportPublication, sniffFormat, FORMATS, formatFromName, PasswordNeeded, QPP_MIME } from '../../src/io';
import { importSla, exportSla } from '../../src/io/sla';
import { textToParas, markdownToParas, rtfToParas, htmlToParas, inlineRuns } from '../../src/io/textImport';
import { mimeOf, headerSize } from '../../src/io/images';
import { pubToText, pubToHtml } from '../../src/export/html';
import { pubToPdf, pdfText, textWidth, stdFont } from '../../src/export/pdf';
import { TEMPLATES } from '../../src/templates';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

/** A publication exercising every item kind. */
function richPub(): Pub {
  const p = Pub.blank({ w: 612, h: 792 }, { facing: true, pages: 2, columns: 2 });
  p.data.props.title = 'Spring Issue';
  p.data.props.author = 'Pat Example';
  p.data.bleed = 9;
  const [a, b] = p.pages;
  const f1 = p.newTextFrame({ x: 36, y: 36, w: 240, h: 120 }, [{ style: 'Heading 1', runs: [{ text: 'Headline & <Deck>' }] }, { style: 'Body', align: 'just', hyphenate: true, runs: [{ text: 'Body text with ' }, { text: 'bold', b: true }, { text: ' and ' }, { text: 'a link', link: 'https://example.com' }] }, { style: 'Bullet List', bullet: { kind: 'char', char: '•' }, runs: [{ text: 'First point' }] }]);
  f1.name = 'Lead'; f1.columns = 2; f1.insets = [4, 4, 4, 4];
  const f2 = p.newTextFrame({ x: 36, y: 36, w: 240, h: 120 });
  f2.story = f1.story; f2.prev = f1.id; f1.next = f2.id;
  a.items.push(f1); b.items.push(f2);
  p.pruneStories();
  const media = p.addMedia({ mime: 'image/png', b64: PNG, name: 'red.png', w: 1, h: 1 });
  a.items.push({ id: 'pic', kind: 'picture', media, x: 300, y: 36, w: 100, h: 100, alt: 'A red square', crop: [0.1, 0, 0, 0], fit: 'fill', wrap: { mode: 'square', offset: 6 } });
  a.items.push({ id: 'star', kind: 'shape', geom: 'star5', x: 300, y: 200, w: 120, h: 120, fill: { type: 'solid', color: 'Primary' }, line: { fill: { type: 'solid', color: '#7F6000' }, width: 2 }, rot: 15 });
  a.items.push({ id: 'ln', kind: 'line', x: 36, y: 400, w: 300, h: 0, line: { fill: { type: 'solid', color: 'Black' }, width: 1, head: 'triangle' } });
  const tbl: TableItem = { id: 'tbl', kind: 'table', x: 36, y: 450, w: 300, h: 44, cols: [150, 150], rows: [{ h: 22, header: true, cells: [{ text: [{ style: 'Table Header', runs: [{ text: 'Item' }] }] }, { text: [{ style: 'Table Header', runs: [{ text: 'Cost' }] }] }] }, { h: 22, cells: [{ text: [{ style: 'Table Text', runs: [{ text: 'Pens' }] }] }, { text: [{ style: 'Table Text', runs: [{ text: '2.5' }] }] }] }], style: { firstRow: true, bandedRows: true } };
  a.items.push(tbl);
  a.items.push({ id: 'grp', kind: 'group', x: 400, y: 400, w: 150, h: 80, children: [{ id: 'g1', kind: 'shape', geom: 'rect', x: 400, y: 400, w: 70, h: 80, fill: { type: 'solid', color: 'Accent' } }, { id: 'g2', kind: 'shape', geom: 'ellipse', x: 480, y: 400, w: 70, h: 80, fill: { type: 'solid', color: 'Secondary' } }] });
  a.guides = [{ pos: 300, dir: 'v' }];
  p.data.masters[0].items.push(p.newTextFrame({ x: 36, y: 760, w: 200, h: 16 }, [{ style: 'Folio', runs: [{ text: '1', field: 'pagenum' }] }]));
  p.data.sections = [{ id: 's', name: 'Body', start: 0, numbering: 'arabicPlain', startAt: 3 }];
  p.data.variables = [{ name: 'Issue', value: 'Spring' }];
  p.data.layers.push({ id: 'notes', name: 'Notes', hidden: true });
  return p;
}

const words = (p: Pub) => p.data.stories.map((s) => textOf(s.paras)).join('|');

describe('formats table', () => {
  it('maps names and sniffs content', async () => {
    expect(formatFromName('x.qpp')?.id).toBe('qpp');
    expect(formatFromName('x.SLA')?.id).toBe('sla');
    expect(formatFromName('x.jpeg')?.id).toBe('image');
    expect(FORMATS.filter((f) => f.canExport).map((f) => f.id)).toEqual(['qpp', 'qppe', 'sla', 'json']);
    const qpp = (await exportPublication(richPub(), 'qpp')).data;
    expect(sniffFormat(qpp, 'anything.bin')).toBe('qpp');
    expect(sniffFormat(new TextEncoder().encode('<?xml version="1.0"?><SCRIBUSUTF8NEW Version="1.5.8"><DOCUMENT/></SCRIBUSUTF8NEW>'), 'a.xml')).toBe('sla');
    expect(sniffFormat(new TextEncoder().encode('{"format":"quillpress"}'), 'a.txt')).toBe('json');
  });
});

describe('native formats', () => {
  it('round-trips .qpp with the mimetype stored first', async () => {
    const p = richPub();
    const { data, mime, ext } = await exportPublication(p, 'qpp');
    expect(mime).toBe(QPP_MIME);
    expect(ext).toBe('qpp');
    const zip = await JSZip.loadAsync(data);
    const names = Object.keys(zip.files);
    expect(names[0]).toBe('mimetype');
    expect(await zip.file('mimetype')!.async('string')).toBe(QPP_MIME);
    expect(names).toContain('publication.json');
    expect(names.some((n) => n.startsWith('media/'))).toBe(true);
    const back = await importPublication(data, 'issue.qpp');
    expect(back.format).toBe('qpp');
    expect(back.pub.pages).toHaveLength(2);
    expect(back.pub.data.props.title).toBe('Spring Issue');
    expect(words(back.pub)).toBe(words(p));
    expect(back.pub.chainOf(p.data.stories[0].id)).toHaveLength(2);
    expect(back.pub.pages[0].items.map((e) => e.kind)).toEqual(['text', 'picture', 'shape', 'line', 'table', 'group']);
    expect(Object.values(back.pub.media)[0].b64).toBe(PNG);
    expect(back.pub.data.sections[0].startAt).toBe(3);
  });

  it('round-trips JSON', async () => {
    const p = richPub();
    const out = await exportPublication(p, 'json');
    const back = await importPublication(out.data, 'issue.json');
    expect(back.format).toBe('json');
    expect(words(back.pub)).toBe(words(p));
  });

  it('encrypts and decrypts .qppe and reports a missing password', async () => {
    const p = richPub();
    const out = await exportPublication(p, 'qppe', { password: 'secret' });
    expect(new TextDecoder().decode(out.data.subarray(0, 5))).toBe('QFDE1');
    await expect(importPublication(out.data, 'issue.qppe')).rejects.toBeInstanceOf(PasswordNeeded);
    await expect(importPublication(out.data, 'issue.qppe', { password: 'wrong' })).rejects.toBeTruthy();
    const back = await importPublication(out.data, 'issue.qppe', { password: 'secret' });
    expect(words(back.pub)).toBe(words(p));
  });
});

describe('Scribus .sla', () => {
  it('exports pages, frames, chains, styles, colors and pictures, and imports them back', async () => {
    const p = richPub();
    const xml = new TextDecoder().decode(exportSla(p));
    expect(xml).toContain('<SCRIBUSUTF8NEW');
    expect(xml).toContain('<PAGE ');
    expect(xml).toContain('<PAGEOBJECT');
    expect(xml).toContain('NEXTITEM');
    expect(xml).toContain('<STYLE ');
    expect(xml).toContain('<COLOR ');
    expect(xml).toContain('Headline &amp; &lt;Deck&gt;');
    const back = await importSla(new TextEncoder().encode(xml));
    expect(back.pub.pages).toHaveLength(2);
    expect(back.pub.size.w).toBeCloseTo(612, 0);
    expect(back.pub.data.facing).toBe(true);
    expect(words(back.pub)).toContain('Headline & <Deck>');
    expect(words(back.pub)).toContain('First point');
    const frames = back.pub.textFrames();
    expect(frames.length).toBeGreaterThanOrEqual(2);
    const chained = frames.find((f) => f.next);
    expect(chained).toBeTruthy();
    expect(back.pub.pages[0].items.some((e) => e.kind === 'picture')).toBe(true);
    expect(back.pub.pages[0].items.some((e) => e.kind === 'shape')).toBe(true);
    expect(back.pub.pages[0].items.some((e) => e.kind === 'table')).toBe(true);
    expect(back.pub.data.styles.para.some((s) => s.name === 'Heading 1')).toBe(true);
    expect(back.pub.data.swatches.some((s) => s.name === 'Primary')).toBe(true);
    expect(Object.keys(back.pub.media).length).toBe(1);
    const again = await importPublication(new TextEncoder().encode(xml), 'issue.sla');
    expect(again.format).toBe('sla');
  });

  it('imports a minimal hand-written Scribus 1.4 file', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<SCRIBUSUTF8NEW Version="1.4.8"><DOCUMENT ANZPAGES="1" PAGEWIDTH="595.28" PAGEHEIGHT="841.89" BORDERLEFT="40" BORDERRIGHT="40" BORDERTOP="40" BORDERBOTTOM="40" ORIENTATION="0" UNITS="1" AUTHOR="A" TITLE="Mini">
<COLOR NAME="Red" RGB="#ff0000"/><COLOR NAME="Blue" CMYK="#ff990000"/>
<STYLE NAME="Default Paragraph Style" FONT="Tinos Regular" FONTSIZE="11"/><STYLE NAME="Head" PARENT="Default Paragraph Style" FONTSIZE="24" ALIGN="1"/>
<MASTERPAGE PAGEXPOS="100" PAGEYPOS="20" PAGEWIDTH="595.28" PAGEHEIGHT="841.89" NAM="Normal" BORDERLEFT="40" BORDERRIGHT="40" BORDERTOP="40" BORDERBOTTOM="40"/>
<PAGE PAGEXPOS="100" PAGEYPOS="20" PAGEWIDTH="595.28" PAGEHEIGHT="841.89" NUM="0" MNAM="Normal" BORDERLEFT="40" BORDERRIGHT="40" BORDERTOP="40" BORDERBOTTOM="40"/>
<PAGEOBJECT XPOS="140" YPOS="60" WIDTH="300" HEIGHT="200" PTYPE="4" OwnPage="0" COLUMNS="2" COLGAP="10" NEXTITEM="1" BACKITEM="-1" ANNAME="Lead"><StoryText><DefaultStyle/><ITEXT CH="Hello "/><ITEXT FONT="Tinos Bold" CH="world"/><para PARENT="Head"/><ITEXT CH="Second paragraph"/><para/></StoryText></PAGEOBJECT>
<PAGEOBJECT XPOS="140" YPOS="300" WIDTH="300" HEIGHT="200" PTYPE="4" OwnPage="0" NEXTITEM="-1" BACKITEM="0"><StoryText><DefaultStyle/></StoryText></PAGEOBJECT>
<PAGEOBJECT XPOS="460" YPOS="60" WIDTH="100" HEIGHT="100" PTYPE="6" OwnPage="0" SHAPE="rect" PCOLOR="Red" PLINE="Blue" PWIDTH="2" NEXTITEM="-1" BACKITEM="-1"/>
<PAGEOBJECT XPOS="460" YPOS="200" WIDTH="100" HEIGHT="100" PTYPE="2" OwnPage="0" PFILE="missing.png" NEXTITEM="-1" BACKITEM="-1"/>
</DOCUMENT></SCRIBUSUTF8NEW>`;
    const { pub, warnings } = await importSla(new TextEncoder().encode(xml));
    expect(pub.size.w).toBeCloseTo(595.28, 1);
    expect(pub.pages).toHaveLength(1);
    expect(pub.data.props.title).toBe('Mini');
    const frames = pub.textFrames();
    expect(frames).toHaveLength(2);
    const lead = frames.find((f) => f.name === 'Lead')!;
    expect(lead.x).toBeCloseTo(40, 0);
    expect(lead.columns).toBe(2);
    expect(lead.next).toBe(frames.find((f) => f !== lead)!.id);
    const s = pub.story(lead.story)!;
    expect(textOf(s.paras)).toBe('Hello world\nSecond paragraph');
    expect(s.paras[0].style).toBe('Head');
    expect(s.paras[0].runs[1].b).toBe(true);
    expect(pub.data.swatches.find((c) => c.name === 'Red')?.color.toLowerCase()).toBe('#ff0000');
    expect(pub.data.swatches.find((c) => c.name === 'Blue')).toBeTruthy();
    expect(pub.pages[0].items.some((e) => e.kind === 'shape')).toBe(true);
    expect(pub.pages[0].items.some((e) => e.kind === 'picture' && !e.media)).toBe(true);
    expect(warnings.some((w) => /missing\.png/.test(w))).toBe(true);
  });
});

describe('text and picture import', () => {
  it('converts text, markdown, rtf and html to paragraphs with styles', () => {
    expect(textToParas('a\n\nb').map((p) => textOf([p]))).toEqual(['a', '', 'b']);
    const md = markdownToParas('# Title\n\nSome *em* and **strong** text.\n\n- one\n- two\n\n> quote');
    expect(md[0].style).toBe('Heading 1');
    expect(md.find((p) => p.style === 'Bullet List')).toBeTruthy();
    expect(md.find((p) => p.style === 'Pull Quote')).toBeTruthy();
    const runs = inlineRuns('x **b** _i_ `c`');
    expect(runs.find((r) => r.b)?.text).toBe('b');
    expect(runs.find((r) => r.i)?.text).toBe('i');
    const rtf = rtfToParas('{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0\\fs24 Hello \\b bold\\b0  world\\par Second\\par}');
    expect(textOf(rtf)).toContain('Hello');
    expect(textOf(rtf)).toContain('Second');
    const html = htmlToParas('<h2>Head</h2><p>Para <b>bold</b></p><ul><li>item</li></ul>');
    expect(html[0].style).toBe('Heading 2');
    expect(html[1].runs.some((r) => r.b)).toBe(true);
  });

  it('detects image types and sizes from headers', () => {
    const png = Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0));
    expect(mimeOf('x.bin', png)).toBe('image/png');
    expect(headerSize('image/png', png)).toEqual({ w: 1, h: 1 });
    expect(mimeOf('photo.JPG')).toBe('image/jpeg');
    expect(mimeOf('v.svg')).toBe('image/svg+xml');
  });

  it('opens a text file, a markdown file and a picture as publications', async () => {
    const t = await importPublication(new TextEncoder().encode('# Hi\n\nBody'), 'notes.md');
    expect(t.format).toBe('md');
    expect(t.pub.textFrames()).toHaveLength(1);
    expect(words(t.pub)).toContain('Hi');
    const png = Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0));
    const i = await importPublication(png, 'red.png');
    expect(i.format).toBe('image');
    expect(i.pub.pages[0].items[0].kind).toBe('picture');
    const svg = await importPublication(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="red"/></svg>'), 'd.svg');
    expect(svg.format).toBe('svg');
    expect(svg.pub.size).toEqual({ w: 200, h: 100 });
  });
});

describe('exports', () => {
  it('writes text and markdown of the stories', () => {
    const p = richPub();
    expect(pubToText(p)).toContain('Headline & <Deck>');
    const md = pubToText(p, true);
    expect(md).toContain('# Headline & <Deck>');
    expect(md).toContain('- First point');
  });

  it('writes a self-contained web page', async () => {
    const html = await pubToHtml(richPub(), { fonts: false });
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<svg');
    expect(html).toContain('Spring Issue');
    expect(html).toContain('aria-label="Page 3"');
  });

  it('writes a valid vector PDF with page labels, trim box and pictures', async () => {
    const p = richPub();
    const pdf = await pubToPdf(p, { bleed: true, marks: true, maxImagePx: 64 });
    const s = new TextDecoder('latin1').decode(pdf);
    expect(s.startsWith('%PDF-1.')).toBe(true);
    expect(s).toContain('/Type /Catalog');
    expect(s).toContain('/Count 2');
    expect(s).toContain('/TrimBox');
    expect(s).toContain('/PageLabels');
    expect(s).toContain('/Image');
    expect(s).toContain('/Helvetica');
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(s).toContain('(Spring Issue)');
    // Cross-reference table points at the objects.
    const xref = s.lastIndexOf('xref');
    expect(xref).toBeGreaterThan(0);
    expect(s).toContain('startxref');
    const pdf2 = await pubToPdf(TEMPLATES.find((t) => t.id === 'newsletter')!.build(), { pages: undefined });
    expect(new TextDecoder('latin1').decode(pdf2)).toContain('/Count 4');
  });

  it('maps fonts to the standard 14 and encodes text', () => {
    expect(stdFont('Tinos', true, false)).toBe('Times-Bold');
    expect(stdFont('Arimo')).toBe('Helvetica');
    expect(stdFont('Courier Prime', false, true)).toBe('Courier-Oblique');
    expect(pdfText('a(b)\\c')).toBe('(a\\(b\\)\\\\c)');
    expect(textWidth('Hello', 10, 'Helvetica')).toBeGreaterThan(20);
  });
});
