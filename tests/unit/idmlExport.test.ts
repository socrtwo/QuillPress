import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { Pub, textOf } from '../../src/model/pub';
import type { TableItem, PathTextItem, ShapeItem } from '../../src/model/types';
import { exportPublication, importPublication, sniffFormat, IDML_MIME } from '../../src/io';
import { exportIdml, pathPointsOf, itemTransform } from '../../src/io/idmlExport';
import { importIdml } from '../../src/io/idml';
import { parseXml } from '../../src/io/xml';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

/** The publication of tests/unit/io.test.ts: every item kind, chains, styles, colors, a picture, a section and a layer. */
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

/** richPub plus a footnote, an anchored object, text on a path, a forced line break, a tab and a dashed rule. */
function fullPub(): Pub {
  const p = richPub();
  const story = p.data.stories[0];
  story.footnotes = [{ id: 'fn1', paras: [{ style: 'Footnote', runs: [{ text: 'A note on the headline.' }] }] }];
  story.paras[0].runs.push({ text: '1', footnote: 'fn1' });
  story.paras.push({ style: 'Body', runs: [{ text: 'Line one' }, { text: '', br: true }, { text: 'Line two\tafter a tab' }] });
  const anchored: ShapeItem = { id: 'anch', kind: 'shape', geom: 'rect', x: 0, y: 0, w: 20, h: 12, fill: { type: 'solid', color: 'Cyan' }, anchored: { story: story.id, mode: 'inline' } };
  story.paras[1].runs.push({ text: '￼', anchor: 'anch' });
  p.pages[0].items.push(anchored);
  const pt: PathTextItem = { id: 'pt', kind: 'pathText', x: 320, y: 600, w: 200, h: 60, path: { d: 'M0 60 Q100 0 200 60', w: 200, h: 60 }, text: [{ style: 'Heading 2', runs: [{ text: 'Along the arc' }] }], align: 'center', offset: 0, baseline: 0, showPath: true, line: { fill: { type: 'solid', color: 'Gray' }, width: 1, dash: 'dashDot' } };
  p.pages[0].items.push(pt);
  p.pages[1].items.push({ id: 'rule', kind: 'line', x: 36, y: 300, w: 200, h: 0, line: { fill: { type: 'solid', color: 'Primary' }, width: 3, dash: 'dash' }, alpha: 0.5, layer: 'notes' });
  return p;
}

const words = (p: Pub) => p.data.stories.map((s) => textOf(s.paras)).join('|');

describe('IDML export', () => {
  it('writes a package whose parts are well-formed XML with the mimetype stored first', async () => {
    const data = await exportIdml(fullPub());
    // The first local file header is the stored (method 0) mimetype entry.
    expect(Array.from(data.subarray(0, 4))).toEqual([0x50, 0x4b, 3, 4]);
    expect(data[8] | (data[9] << 8)).toBe(0);
    expect(new TextDecoder().decode(data.subarray(30, 38))).toBe('mimetype');
    expect(new TextDecoder().decode(data.subarray(38, 38 + IDML_MIME.length))).toBe(IDML_MIME);
    const zip = await JSZip.loadAsync(data);
    const names = Object.keys(zip.files).filter((x) => !zip.files[x].dir);
    expect(names[0]).toBe('mimetype');
    for (const required of ['designmap.xml', 'META-INF/container.xml', 'META-INF/metadata.xml', 'Resources/Fonts.xml', 'Resources/Graphic.xml', 'Resources/Preferences.xml', 'Resources/Styles.xml', 'XML/BackingStory.xml', 'XML/Tags.xml']) expect(names).toContain(required);
    expect(names.filter((x) => x.startsWith('MasterSpreads/MasterSpread_')).length).toBe(1);
    expect(names.filter((x) => x.startsWith('Spreads/Spread_')).length).toBe(2);
    expect(names.filter((x) => x.startsWith('Stories/Story_')).length).toBeGreaterThanOrEqual(4);
    for (const name of names) {
      if (name === 'mimetype' || zip.files[name].dir) continue;
      const text = await zip.file(name)!.async('string');
      expect(parseXml(text), name).not.toBeNull();
    }
    const designmap = await zip.file('designmap.xml')!.async('string');
    expect(designmap).toContain('xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"');
    expect(designmap).toContain('DOMVersion="');
    expect(designmap).toContain('<idPkg:Graphic src="Resources/Graphic.xml"/>');
    expect(designmap).toContain('<Layer ');
    expect(designmap).toContain('<Section ');
    expect(designmap).toContain('<TextVariable ');
    expect(designmap).toContain('<Hyperlink ');
    const styles = await zip.file('Resources/Styles.xml')!.async('string');
    expect(styles).toContain('<ParagraphStyle Self="ParagraphStyle/Heading 1" Name="Heading 1"');
    expect(styles).toContain('<CharacterStyle Self="CharacterStyle/Emphasis"');
    expect(styles).toContain('<ObjectStyle Self="ObjectStyle/Sidebar"');
    const graphic = await zip.file('Resources/Graphic.xml')!.async('string');
    expect(graphic).toContain('Self="Color/Primary"');
    expect(graphic).toContain('Space="RGB" ColorValue="91 60 158"'); // its CMYK values do not reproduce #5B3C9E
    expect(graphic).toContain('<Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100"');
    expect(graphic).toContain('Self="Color/R=127 G=96 B=0"');
    expect(graphic).toContain('<DashedStrokeStyle Self="StrokeStyle/Dash Dot"');
    const stories = (await Promise.all(names.filter((x) => x.startsWith('Stories/')).map((x) => zip.file(x)!.async('string')))).join('\n');
    expect(stories).toContain('Headline &amp; &lt;Deck&gt;');
    expect(stories).toContain('<Footnote Self=');
    expect(stories).toContain('<?ACE 4?>');
    expect(stories).toContain('&#x2028;');
    expect(stories).toContain('<HyperlinkTextSource ');
    expect(stories).toContain('<Table Self=');
    expect(stories).toContain('Name="1:1"');
    expect(stories).toContain('<Rectangle '); // the anchored object sits in its story
    expect(stories).toContain('<AnchoredObjectSetting AnchoredPosition="InlinePosition"');
    expect(stories).toContain('Along the arc');
    const spreads = (await Promise.all(names.filter((x) => x.startsWith('Spreads/')).map((x) => zip.file(x)!.async('string')))).join('\n');
    expect(spreads).toContain('<TextFrame ');
    expect(spreads).toContain('<Polygon ');
    expect(spreads).toContain('<GraphicLine ');
    expect(spreads).toContain('<Group ');
    expect(spreads).toContain('<Image ');
    expect(spreads).toContain(`<Contents>${PNG}</Contents>`);
    expect(spreads).toContain('LinkResourceURI="file:///red.png"');
    expect(spreads).toContain('<TextPath ');
    expect(spreads).toContain('TextWrapMode="BoundingBoxTextWrap"');
    expect(spreads).toContain('<BlendingSetting Opacity="50"/>');
    expect(spreads).toContain('RightLineEnd="TriangleArrowHead"');
    expect(spreads).toContain('StrokeType="StrokeStyle/$ID/Dashed (3 and 2)"');
    expect(spreads).not.toContain('Self="anch"');
    const prefs = await zip.file('Resources/Preferences.xml')!.async('string');
    expect(prefs).toContain('PageWidth="612"');
    expect(prefs).toContain('FacingPages="true"');
    expect(prefs).toContain('DocumentBleedTopOffset="9"');
    expect(prefs).toContain('HorizontalMeasurementUnits="Inches"');
    const meta = await zip.file('META-INF/metadata.xml')!.async('string');
    expect(meta).toContain('Spring Issue');
    expect(meta).toContain('Pat Example');
  });

  it('re-imports through importIdml with pages, masters, chains, text, styles, colors, pictures and footnotes', async () => {
    const src = fullPub();
    const data = await exportIdml(src);
    expect(sniffFormat(data, 'anything.bin')).toBe('idml');
    const { pub, warnings } = await importIdml(data);
    expect(pub.pages).toHaveLength(2);
    expect(pub.data.facing).toBe(true);
    expect(pub.size.w).toBeCloseTo(612, 2);
    expect(pub.data.bleed).toBe(9);
    expect(pub.data.unit).toBe('in');
    expect(pub.data.props.title).toBe('Spring Issue');
    expect(pub.data.props.author).toBe('Pat Example');
    // Masters and page geometry.
    expect(pub.data.masters).toHaveLength(1);
    expect(pub.data.masters[0].name).toBe('A-Master');
    expect(pub.data.masters[0].columns).toBe(2);
    expect(pub.data.masters[0].items.some((e) => e.kind === 'text')).toBe(true);
    // The chained lead story.
    const lead = pub.textFrames().find((f) => f.name === 'Lead')!;
    expect(lead).toBeTruthy();
    expect(lead.x).toBeCloseTo(36, 1);
    expect(lead.y).toBeCloseTo(36, 1);
    expect(lead.w).toBeCloseTo(240, 1);
    expect(lead.columns).toBe(2);
    expect(lead.insets).toEqual([4, 4, 4, 4]);
    const chain = pub.chainOf(lead.story);
    expect(chain).toHaveLength(2);
    expect(chain[0].id).toBe(lead.id);
    expect(pub.pageOfItem(chain[1].id)).toBe(pub.pages[1]);
    const story = pub.story(lead.story)!;
    expect(story.paras[0].style).toBe('Heading 1');
    expect(textOf([story.paras[0]])).toBe('Headline & <Deck>1');
    expect(story.paras[1].align).toBe('just');
    expect(story.paras[1].runs.some((r) => r.b && r.text === 'bold')).toBe(true);
    expect(story.paras[2].style).toBe('Bullet List');
    expect(textOf([story.paras[2]])).toBe('First point');
    expect(textOf([story.paras[3]])).toBe('Line one\nLine two\tafter a tab');
    expect(story.footnotes).toHaveLength(1);
    expect(textOf(story.footnotes![0].paras)).toBe('A note on the headline.');
    expect(story.paras[0].runs.find((r) => r.footnote)).toBeTruthy();
    // Styles and colors.
    expect(pub.data.styles.para.some((s) => s.name === 'Heading 1')).toBe(true);
    expect(pub.paraStyle('Heading 1')!.run!.size).toBe(24);
    expect(pub.paraStyle('Heading 1')!.run!.b).toBe(true);
    expect(pub.paraStyle('Heading 1')!.run!.font).toBe('Arimo');
    expect(pub.paraStyle('Bullet List')!.basedOn).toBe('Body');
    expect(pub.paraStyle('Bullet List')!.marL).toBe(14);
    expect(pub.charStyle('Emphasis')!.i).toBe(true);
    expect(pub.data.styles.object.some((s) => s.name === 'Sidebar')).toBe(true);
    expect(pub.swatch('Primary')!.color).toBe('#5B3C9E');
    expect(pub.swatch('Black')!.cmyk).toEqual([0, 0, 0, 100]);
    expect(pub.swatch('R=127 G=96 B=0')!.color).toBe('#7F6000');
    // Items on page 1.
    const items = pub.pages[0].items;
    const pic = items.find((e) => e.kind === 'picture');
    expect(pic).toBeTruthy();
    expect(pic!.media && pub.media[pic!.media].b64).toBe(PNG);
    expect(pic!.x).toBeCloseTo(300, 1);
    expect(pic!.wrap?.mode).toBe('square');
    const star = items.find((e) => e.kind === 'shape' && e.rot) as ShapeItem;
    expect(star).toBeTruthy();
    expect(star.rot).toBeCloseTo(15, 1);
    // A preset's path need not fill its box: the polygon comes back with the path's own bounds.
    expect(star.x).toBeGreaterThanOrEqual(300);
    expect(star.x + star.w).toBeLessThanOrEqual(420.01);
    expect(star.w).toBeGreaterThan(100);
    expect(star.geom).toBe('custom');
    expect(star.fill).toEqual({ type: 'solid', color: 'Primary' });
    expect(star.line?.width).toBe(2);
    const line = items.find((e) => e.kind === 'line' && Math.abs(e.w - 300) < 0.01);
    expect(line).toBeTruthy();
    expect(line!.x).toBeCloseTo(36, 1);
    expect(line!.y).toBeCloseTo(400, 1);
    expect(items.some((e) => e.kind === 'group' && e.children.length === 2)).toBe(true);
    // The table is a text frame holding tab-separated rows.
    const tableFrame = pub.textFrames().find((f) => Math.abs(f.y - 450) < 0.01 && pub.pageOfItem(f.id) === pub.pages[0]);
    expect(tableFrame).toBeTruthy();
    expect(textOf(pub.story(tableFrame!.story)!.paras)).toBe('Item\tCost\nPens\t2.5');
    // The anchored object came back as a free object; the path text as its path.
    expect(items.filter((e) => e.kind === 'shape' && e.w === 20 && e.h === 12)).toHaveLength(1);
    expect(warnings.some((w) => /anchored/.test(w))).toBe(true);
    const dashed = pub.pages[1].items.find((e) => e.kind === 'line');
    expect(dashed).toBeTruthy();
    expect(dashed!.line?.dash).toBe('dash');
    expect(dashed!.alpha).toBe(0.5);
    expect(dashed!.layer).toBeTruthy();
    expect(pub.layer(dashed!.layer)!.name).toBe('Notes');
    expect(pub.layer(dashed!.layer)!.hidden).toBe(true);
    // Sections and variables.
    expect(pub.data.sections).toHaveLength(1);
    expect(pub.data.sections[0].startAt).toBe(3);
    expect(pub.data.sections[0].name).toBe('Body');
    expect(pub.data.variables).toEqual([{ name: 'Issue', value: 'Spring' }]);
  });

  it('is stable: exporting the re-imported publication keeps the page count and the text', async () => {
    const first = await exportIdml(fullPub());
    const back = await importIdml(first);
    const second = await exportIdml(back.pub);
    const again = await importIdml(second);
    expect(again.pub.pages.length).toBe(back.pub.pages.length);
    expect(words(again.pub)).toBe(words(back.pub));
    expect(again.pub.textFrames().length).toBe(back.pub.textFrames().length);
  });

  it('is reachable through the format registry', async () => {
    const out = await exportPublication(richPub(), 'idml');
    expect(out.mime).toBe(IDML_MIME);
    expect(out.ext).toBe('idml');
    const back = await importPublication(out.data, 'issue.idml');
    expect(back.format).toBe('idml');
    expect(words(back.pub)).toContain('First point');
  });

  it('converts paths to anchor points and composes item transforms the importer inverts', () => {
    const rect = pathPointsOf('M0 0 L10 0 L10 5 L0 5 Z');
    expect(rect).toHaveLength(1);
    expect(rect[0].open).toBe(false);
    expect(rect[0].pts.map((p) => [p.x, p.y])).toEqual([[0, 0], [10, 0], [10, 5], [0, 5]]);
    const curve = pathPointsOf('M0 10 C0 0 10 0 10 10');
    expect(curve[0].open).toBe(true);
    expect(curve[0].pts[0].r).toEqual({ x: 0, y: 0 });
    expect(curve[0].pts[1].l).toEqual({ x: 10, y: 0 });
    expect(itemTransform(50, 25, 100, 50)).toBe('1 0 0 1 0 0');
    expect(itemTransform(50, 25, 100, 50, 90).split(' ').map(Number).map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 1, -1, 0, 75, -25]);
    expect(itemTransform(50, 25, 100, 50, 0, true).split(' ').map(Number)).toEqual([-1, 0, 0, 1, 100, 0]);
  });
});
