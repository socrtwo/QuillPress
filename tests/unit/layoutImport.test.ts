import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { importPublication, sniffFormat, FORMATS, formatFromName } from '../../src/io';
import { importIdml } from '../../src/io/idml';
import { importMsPub, isMsPub, escherBlips, quillText } from '../../src/io/mspub';
import { importLegacyLayout, isQxp, isIndd, isPageMaker, utf16Runs, byteRuns, paragraphsFrom } from '../../src/io/legacyLayout';
import { importXpressTags, decodeXtg } from '../../src/io/xpressTags';
import { importMif, parseMif, mifPoints } from '../../src/io/mif';
import { openCfb } from '../../src/io/cfb';
import { analyze } from '../../src/io/recover/fileid';
import { textOf } from '../../src/model/pub';
import type { TextFrame, ShapeItem, PictureFrame, GroupItem, LineItem } from '../../src/model/types';
import { getCommand } from '../../src/commands/registry';
import '../../src/commands/index';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const pngBytes = () => Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0));
const enc = (s: string) => new TextEncoder().encode(s);

// ------------------------------------------------------------------------------------------
// IDML package built in code

const rect = (x0: number, y0: number, x1: number, y1: number, open = false) => `<Properties><PathGeometry><GeometryPathType PathOpen="${open}"><PathPointArray>
<PathPointType Anchor="${x0} ${y0}" LeftDirection="${x0} ${y0}" RightDirection="${x0} ${y0}"/>
<PathPointType Anchor="${x0} ${y1}" LeftDirection="${x0} ${y1}" RightDirection="${x0} ${y1}"/>
<PathPointType Anchor="${x1} ${y1}" LeftDirection="${x1} ${y1}" RightDirection="${x1} ${y1}"/>
<PathPointType Anchor="${x1} ${y0}" LeftDirection="${x1} ${y0}" RightDirection="${x1} ${y0}"/>
</PathPointArray></GeometryPathType></PathGeometry></Properties>`;
const NS = 'xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

async function idmlPackage(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/vnd.adobe.indesign-idml-package', { compression: 'STORE' });
  zip.file('designmap.xml', `${XML}<Document ${NS} DOMVersion="8.0" Self="d" Name="Spring.indd">
<idPkg:Graphic src="Resources/Graphic.xml"/><idPkg:Styles src="Resources/Styles.xml"/><idPkg:Preferences src="Resources/Preferences.xml"/>
<Layer Self="ua" Name="Layer 1" Visible="true" Locked="false"/><Layer Self="ub" Name="Pictures" Visible="true" Locked="true"/>
<Section Self="usec" Name="" PageStart="up1" PageNumberStart="1" ContinueNumbering="true" PageNumberStyle="Arabic"/>
<idPkg:MasterSpread src="MasterSpreads/MasterSpread_um.xml"/>
<idPkg:Spread src="Spreads/Spread_u1.xml"/><idPkg:Spread src="Spreads/Spread_u2.xml"/>
<idPkg:Story src="Stories/Story_us1.xml"/><idPkg:Story src="Stories/Story_us2.xml"/>
<TextVariable Self="dTextVariablenIssue" Name="Issue" VariableType="CustomTextType"><CustomTextVariablePreference TextString="Spring"/></TextVariable>
</Document>`);
  zip.file('META-INF/metadata.xml', `${XML}<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Spring Issue</rdf:li></rdf:Alt></dc:title><dc:creator><rdf:Seq><rdf:li>Pat Example</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>`);
  zip.file('Resources/Preferences.xml', `${XML}<idPkg:Preferences ${NS}><DocumentPreference PageHeight="792" PageWidth="612" FacingPages="true" DocumentBleedTopOffset="9" DocumentBleedBottomOffset="9" DocumentBleedInsideOrLeftOffset="9" DocumentBleedOutsideOrRightOffset="9"/><ViewPreference HorizontalMeasurementUnits="Inches" VerticalMeasurementUnits="Inches"/></idPkg:Preferences>`);
  zip.file('Resources/Graphic.xml', `${XML}<idPkg:Graphic ${NS}>
<Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100" Name="Black"/>
<Color Self="Color/Paper" Model="Process" Space="CMYK" ColorValue="0 0 0 0" Name="Paper"/>
<Color Self="Color/C=100 M=0 Y=0 K=0" Model="Process" Space="CMYK" ColorValue="100 0 0 0" Name="C=100 M=0 Y=0 K=0"/>
<Color Self="Color/Coral" Model="Process" Space="RGB" ColorValue="255 127 80" Name="Coral"/>
<Tint Self="Tint/Coral 50" BaseColor="Color/Coral" TintValue="50"/>
<Gradient Self="Gradient/Sunset" Type="Linear" Name="Sunset"><GradientStop Self="g0" StopColor="Color/Coral" Location="0"/><GradientStop Self="g1" StopColor="Color/Black" Location="100"/></Gradient>
</idPkg:Graphic>`);
  zip.file('Resources/Styles.xml', `${XML}<idPkg:Styles ${NS}>
<RootCharacterStyleGroup Self="u7a"><CharacterStyle Self="CharacterStyle/$ID/[No character style]" Name="$ID/[No character style]"/><CharacterStyle Self="CharacterStyle/Emphasis" Name="Emphasis" FontStyle="Italic"/></RootCharacterStyleGroup>
<RootParagraphStyleGroup Self="u7b">
<ParagraphStyle Self="ParagraphStyle/$ID/NormalParagraphStyle" Name="$ID/NormalParagraphStyle" PointSize="10"/>
<ParagraphStyle Self="ParagraphStyle/Headline" Name="Headline" PointSize="24" Justification="CenterAlign" FontStyle="Bold" SpaceAfter="6"><Properties><BasedOn type="object">ParagraphStyle/$ID/NormalParagraphStyle</BasedOn><AppliedFont type="string">Minion Pro</AppliedFont><Leading type="unit">28</Leading></Properties></ParagraphStyle>
<ParagraphStyle Self="ParagraphStyle/Body Text" Name="Body Text" PointSize="10" Justification="LeftJustified" Hyphenation="true" FirstLineIndent="12" FillColor="Color/Black"><Properties><AppliedFont type="string">Minion Pro</AppliedFont></Properties></ParagraphStyle>
<ParagraphStyleGroup Self="ug" Name="Lists"><ParagraphStyle Self="ParagraphStyle/Lists%3aBullets" Name="Bullets" BulletsAndNumberingListType="BulletList"/></ParagraphStyleGroup>
</RootParagraphStyleGroup>
<RootObjectStyleGroup Self="u7c"><ObjectStyle Self="ObjectStyle/$ID/[None]" Name="$ID/[None]"/><ObjectStyle Self="ObjectStyle/Box" Name="Box" FillColor="Color/Coral" StrokeWeight="2" StrokeColor="Color/Black"/></RootObjectStyleGroup>
</idPkg:Styles>`);
  zip.file('MasterSpreads/MasterSpread_um.xml', `${XML}<idPkg:MasterSpread ${NS}><MasterSpread Self="um" Name="A-Master" NamePrefix="A" BaseName="Master" PageCount="2">
<Page Self="umL" Name="A" GeometricBounds="0 0 792 612" ItemTransform="1 0 0 1 -612 -396"><MarginPreference ColumnCount="2" ColumnGutter="12" Top="36" Bottom="36" Left="36" Right="36"/></Page>
<Page Self="umR" Name="A" GeometricBounds="0 0 792 612" ItemTransform="1 0 0 1 0 -396"><MarginPreference ColumnCount="2" ColumnGutter="12" Top="36" Bottom="36" Left="36" Right="36"/></Page>
<TextFrame Self="umtf" ParentStory="us2" PreviousTextFrame="n" NextTextFrame="n" ItemTransform="1 0 0 1 36 -396" ItemLayer="ua">${rect(0, 740, 200, 760)}<TextFramePreference TextColumnCount="1"/></TextFrame>
</MasterSpread></idPkg:MasterSpread>`);
  zip.file('Spreads/Spread_u1.xml', `${XML}<idPkg:Spread ${NS}><Spread Self="u1" PageCount="1" BindingLocation="0">
<Page Self="up1" Name="1" AppliedMaster="um" GeometricBounds="0 0 792 612" ItemTransform="1 0 0 1 0 -396"><MarginPreference ColumnCount="2" ColumnGutter="12" Top="36" Bottom="36" Left="36" Right="36"/></Page>
<TextFrame Self="utf1" ParentStory="us1" PreviousTextFrame="n" NextTextFrame="utf2" ItemTransform="1 0 0 1 36 -360" ItemLayer="ua" Name="Lead">${rect(0, 0, 270, 300)}<TextFramePreference TextColumnCount="2" TextColumnGutter="12" VerticalJustification="TopAlign"><Properties><InsetSpacing type="list"><ListItem type="unit">4</ListItem><ListItem type="unit">4</ListItem><ListItem type="unit">4</ListItem><ListItem type="unit">4</ListItem></InsetSpacing></Properties></TextFramePreference></TextFrame>
<Rectangle Self="ur1" FillColor="Color/C=100 M=0 Y=0 K=0" StrokeColor="Color/Black" StrokeWeight="2" ItemTransform="1 0 0 1 340 -360" ItemLayer="ua">${rect(0, 0, 200, 100)}<TextWrapPreference TextWrapMode="BoundingBoxTextWrap"><Properties><TextWrapOffset Top="6" Left="6" Bottom="6" Right="6"/></Properties></TextWrapPreference></Rectangle>
<Oval Self="uo1" FillColor="Tint/Coral 50" StrokeColor="Swatch/None" ItemTransform="1 0 0 1 340 -220" ItemLayer="ub">${rect(0, 0, 100, 60)}<TransparencySetting><BlendingSetting Opacity="50"/></TransparencySetting></Oval>
<Rectangle Self="ur2" StrokeColor="Swatch/None" ItemTransform="1 0 0 1 36 -40" ItemLayer="ub">${rect(0, 0, 200, 150)}<Image Self="ui1" ItemTransform="1 0 0 1 0 0" ActualPpi="72 72"><Link Self="ul1" LinkResourceURI="file:/Users/pat/Pictures/cover%20photo.jpg"/></Image></Rectangle>
<Rectangle Self="ur3" StrokeColor="Swatch/None" ItemTransform="1 0 0 1 250 -40">${rect(0, 0, 60, 60)}<Image Self="ui2" ItemTransform="1 0 0 1 0 0"><Properties><Contents>${PNG}</Contents></Properties></Image></Rectangle>
<Group Self="ug1" ItemTransform="1 0 0 1 340 -40"><Rectangle Self="ug1a" FillColor="Color/Coral" ItemTransform="1 0 0 1 0 0">${rect(0, 0, 60, 60)}</Rectangle><Rectangle Self="ug1b" FillColor="Gradient/Sunset" ItemTransform="1 0 0 1 80 0">${rect(0, 0, 60, 60)}</Rectangle></Group>
<GraphicLine Self="ugl" StrokeColor="Color/Black" StrokeWeight="1" ItemTransform="1 0 0 1 36 -60"><Properties><PathGeometry><GeometryPathType PathOpen="true"><PathPointArray><PathPointType Anchor="0 0" LeftDirection="0 0" RightDirection="0 0"/><PathPointType Anchor="300 0" LeftDirection="300 0" RightDirection="300 0"/></PathPointArray></GeometryPathType></PathGeometry></Properties></GraphicLine>
<Rectangle Self="ur4" FillColor="Color/Black" ItemTransform="0.70710678 0.70710678 -0.70710678 0.70710678 500 -100">${rect(0, 0, 50, 50)}</Rectangle>
<Button Self="ubt"/>
</Spread></idPkg:Spread>`);
  zip.file('Spreads/Spread_u2.xml', `${XML}<idPkg:Spread ${NS}><Spread Self="u2" PageCount="2" BindingLocation="1">
<Page Self="up2" Name="2" AppliedMaster="um" GeometricBounds="0 0 792 612" ItemTransform="1 0 0 1 -612 -396"><MarginPreference ColumnCount="2" ColumnGutter="12" Top="36" Bottom="36" Left="36" Right="36"/></Page>
<Page Self="up3" Name="3" AppliedMaster="um" GeometricBounds="0 0 792 612" ItemTransform="1 0 0 1 0 -396"><MarginPreference ColumnCount="1" ColumnGutter="12" Top="36" Bottom="36" Left="36" Right="36"/></Page>
<TextFrame Self="utf2" ParentStory="us1" PreviousTextFrame="utf1" NextTextFrame="n" ItemTransform="1 0 0 1 -576 -360">${rect(0, 0, 270, 600)}<TextFramePreference TextColumnCount="1"/></TextFrame>
<Polygon Self="upoly" FillColor="Color/Coral" ItemTransform="1 0 0 1 100 -300"><Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray><PathPointType Anchor="0 100" LeftDirection="0 100" RightDirection="0 100"/><PathPointType Anchor="50 0" LeftDirection="50 0" RightDirection="50 0"/><PathPointType Anchor="100 100" LeftDirection="100 100" RightDirection="100 100"/></PathPointArray></GeometryPathType></PathGeometry></Properties></Polygon>
</Spread></idPkg:Spread>`);
  zip.file('Stories/Story_us1.xml', `${XML}<idPkg:Story ${NS}><Story Self="us1" StoryTitle="Lead"><StoryPreference OpticalMarginAlignment="false"/>
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Headline"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>Spring Issue</Content><Br/></CharacterStyleRange></ParagraphStyleRange>
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Body Text"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>Body text with </Content></CharacterStyleRange><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]" FontStyle="Bold"><Content>bold</Content></CharacterStyleRange><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/Emphasis"><Content> and emphasis</Content></CharacterStyleRange><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>.</Content><Br/><Content>Second paragraph&#x2028;with a forced break and a footnote</Content><Footnote><ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle"><CharacterStyleRange><Content>Source: the archive.</Content></CharacterStyleRange></ParagraphStyleRange></Footnote><Content>.</Content><Br/></CharacterStyleRange></ParagraphStyleRange>
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Lists%3aBullets"><CharacterStyleRange><Content>First point</Content><Br/><Content>Second point</Content><Br/></CharacterStyleRange></ParagraphStyleRange>
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Body Text"><CharacterStyleRange><Table Self="ut1" ColumnCount="2" BodyRowCount="2" HeaderRowCount="0"><Column Self="utc0" Name="0"/><Column Self="utc1" Name="1"/><Row Self="utr0" Name="0"/><Row Self="utr1" Name="1"/>
<Cell Self="c00" Name="0:0"><ParagraphStyleRange><CharacterStyleRange><Content>Item</Content></CharacterStyleRange></ParagraphStyleRange></Cell><Cell Self="c10" Name="1:0"><ParagraphStyleRange><CharacterStyleRange><Content>Cost</Content></CharacterStyleRange></ParagraphStyleRange></Cell>
<Cell Self="c01" Name="0:1"><ParagraphStyleRange><CharacterStyleRange><Content>Pens</Content></CharacterStyleRange></ParagraphStyleRange></Cell><Cell Self="c11" Name="1:1"><ParagraphStyleRange><CharacterStyleRange><Content>2.5</Content></CharacterStyleRange></ParagraphStyleRange></Cell></Table></CharacterStyleRange></ParagraphStyleRange>
</Story></idPkg:Story>`);
  zip.file('Stories/Story_us2.xml', `${XML}<idPkg:Story ${NS}><Story Self="us2"><ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle"><CharacterStyleRange><Content>Page </Content><TextVariableInstance Self="utv" ResultText="Spring" Name="Issue"/></CharacterStyleRange></ParagraphStyleRange></Story></idPkg:Story>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

describe('IDML import', () => {
  it('reads document, masters, spreads, frames, chains, styles, colors and stories', async () => {
    const bytes = await idmlPackage();
    expect(sniffFormat(bytes, 'spring.idml')).toBe('idml');
    expect(sniffFormat(bytes, 'anything.bin')).toBe('idml');
    expect(analyze(bytes, 'spring.idml').primary.ext).toBe('idml');
    const { pub, warnings } = await importIdml(bytes);
    const P = pub.data;
    expect(P.size).toEqual({ w: 612, h: 792 });
    expect(P.facing).toBe(true);
    expect(P.bleed).toBe(9);
    expect(P.unit).toBe('in');
    expect(P.props.title).toBe('Spring Issue');
    expect(P.props.author).toBe('Pat Example');
    // Layers
    expect(P.layers.map((l) => l.name)).toEqual(['Layer 1', 'Pictures']);
    expect(P.layers[1].locked).toBe(true);
    // Masters: one per master-spread page, applied by side
    expect(P.masters.map((m) => m.name)).toEqual(['A-Master (Left)', 'A-Master (Right)']);
    expect(P.masters[0].columns).toBe(2);
    expect(pub.pages).toHaveLength(3);
    expect(pub.masterOf(pub.pages[0]).side).toBe('right');
    expect(pub.masterOf(pub.pages[1]).side).toBe('left');
    expect(pub.pages[2].columns).toBe(1);
    const masterFrame = P.masters[1].items.find((e) => e.kind === 'text') as TextFrame;
    expect(masterFrame.x).toBe(36); expect(masterFrame.y).toBe(740);
    expect(textOf(pub.story(masterFrame.story)!.paras)).toBe('Page Spring');
    expect(P.variables).toEqual([{ name: 'Issue', value: 'Spring' }]);
    expect(P.sections).toHaveLength(0);
    // Swatches
    const cyan = P.swatches.find((s) => s.name === 'C=100 M=0 Y=0 K=0')!;
    expect(cyan.color.toLowerCase()).toBe('#00ffff');
    expect(cyan.cmyk).toEqual([100, 0, 0, 0]);
    expect(P.swatches.find((s) => s.name === 'Coral')!.color.toLowerCase()).toBe('#ff7f50');
    expect(P.swatches.find((s) => s.name === 'Coral 50%')).toBeTruthy();
    // Styles
    const head = P.styles.para.find((s) => s.name === 'Headline')!;
    expect(head.align).toBe('ctr');
    expect(head.run?.size).toBe(24);
    expect(head.run?.b).toBe(true);
    expect(head.run?.font).toBe('Minion Pro');
    expect(head.lineSpacing).toBe(28);
    expect(head.lineSpacingPt).toBe(true);
    expect(head.basedOn).toBe('Body');
    const body = P.styles.para.find((s) => s.name === 'Body Text')!;
    expect(body.hyphenate).toBe(true);
    expect(body.indent).toBe(12);
    expect(body.align).toBe('just');
    expect(P.styles.para.find((s) => s.name === 'Bullets')?.bullet?.kind).toBe('char');
    expect(P.styles.char.find((s) => s.name === 'Emphasis')?.i).toBe(true);
    expect(P.styles.object.find((s) => s.name === 'Box')?.line?.width).toBe(2);
    // Frames and chain
    const page1 = pub.pages[0];
    const lead = page1.items.find((e) => e.kind === 'text') as TextFrame;
    expect([lead.x, lead.y, lead.w, lead.h]).toEqual([36, 36, 270, 300]);
    expect(lead.columns).toBe(2);
    expect(lead.insets).toEqual([4, 4, 4, 4]);
    expect(lead.name).toBe('Lead');
    const chain = pub.chainOf(lead.story);
    expect(chain).toHaveLength(2);
    expect(chain[1].x).toBe(36);
    expect(pub.pageIndex(pub.pageOfItem(chain[1].id)!.id)).toBe(1);
    // Story text
    const story = pub.story(lead.story)!;
    const texts = story.paras.map((p) => p.runs.map((r) => (r.br ? '\n' : r.text)).join(''));
    expect(texts[0]).toBe('Spring Issue');
    expect(story.paras[0].style).toBe('Headline');
    expect(texts[1]).toBe('Body text with bold and emphasis.');
    expect(story.paras[1].runs.find((r) => r.text === 'bold')?.b).toBe(true);
    expect(story.paras[1].runs.find((r) => r.text === ' and emphasis')?.cstyle).toBe('Emphasis');
    expect(texts[2]).toMatch(/^Second paragraph\nwith a forced break and a footnote1\.$/);
    expect(story.paras[3].style).toBe('Bullets');
    expect(texts[3]).toBe('First point');
    expect(texts[4]).toBe('Second point');
    expect(texts.slice(5)).toContain('Item\tCost');
    expect(texts.slice(5)).toContain('Pens\t2.5');
    const fn = (story as any).footnotes;
    if (fn) expect(textOf(fn[0].paras)).toBe('Source: the archive.');
    else expect(texts.join('\n')).toContain('Source: the archive.');
    // Shapes, pictures, group, line, rotation
    const shapes = page1.items.filter((e) => e.kind === 'shape') as ShapeItem[];
    const blue = shapes.find((s) => s.fill?.type === 'solid' && s.fill.color === 'C=100 M=0 Y=0 K=0')!;
    expect([blue.x, blue.y, blue.w, blue.h]).toEqual([340, 36, 200, 100]);
    expect(blue.line?.width).toBe(2);
    expect(blue.wrap).toEqual({ mode: 'square', offset: 6 });
    const oval = shapes.find((s) => s.geom === 'ellipse')!;
    expect(oval.fill).toEqual({ type: 'solid', color: 'Coral 50%' });
    expect(oval.alpha).toBe(0.5);
    expect(oval.layer).toBe(P.layers[1].id);
    const rotated = shapes.find((s) => s.rot)!;
    expect(rotated.rot).toBeCloseTo(45, 0);
    const pics = page1.items.filter((e) => e.kind === 'picture') as PictureFrame[];
    expect(pics).toHaveLength(2);
    expect(pics.find((p) => p.src === 'cover photo.jpg')?.media).toBeUndefined();
    expect(pics.find((p) => p.media)).toBeTruthy();
    const group = page1.items.find((e) => e.kind === 'group') as GroupItem;
    expect([group.x, group.y, group.w, group.h]).toEqual([340, 356, 140, 60]);
    expect(group.children).toHaveLength(2);
    expect((group.children[1] as ShapeItem).fill?.type).toBe('gradient');
    const line = page1.items.find((e) => e.kind === 'line') as LineItem;
    expect([line.x, line.y, line.w, line.h]).toEqual([36, 336, 300, 0]);
    const poly = pub.pages[2].items.find((e) => e.kind === 'shape') as ShapeItem;
    expect(poly.geom).toBe('custom');
    expect(poly.path?.[0].d).toMatch(/^M0 100 L50 0 L100 100 Z$/);
    expect([poly.x, poly.y]).toEqual([100, 96]);
    // Warnings
    expect(warnings.join('\n')).toContain('cover photo.jpg');
    expect(warnings.join('\n')).toMatch(/1 table/);
    expect(warnings.join('\n')).toMatch(/1 Button/);
    expect(warnings.join('\n')).toContain('Minion Pro');
    // The general open path
    const r = await importPublication(bytes, 'spring.idml');
    expect(r.format).toBe('idml');
    expect(r.pub.pages).toHaveLength(3);
  });
});

// ------------------------------------------------------------------------------------------
// A compound file (OLE2) built in code, with a Quill stream and an Escher PNG blip

function u16(b: Uint8Array, o: number, v: number): void { b[o] = v & 255; b[o + 1] = (v >> 8) & 255; }
function u32(b: Uint8Array, o: number, v: number): void { u16(b, o, v & 0xffff); u16(b, o + 2, (v >>> 16) & 0xffff); }
function utf16(s: string): Uint8Array { const b = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) u16(b, i * 2, s.charCodeAt(i)); return b; }

/** A version-3 compound file holding the given streams in regular sectors (each padded past the mini cutoff). */
function cfbFile(streams: { name: string; data: Uint8Array }[]): Uint8Array {
  const SEC = 512;
  const padded = streams.map((s) => { const n = Math.max(4096, s.data.length); const d = new Uint8Array(Math.ceil(n / SEC) * SEC); d.set(s.data); return { ...s, data: d, size: s.data.length }; });
  const nSectors = 2 + padded.reduce((a, s) => a + s.data.length / SEC, 0);
  const out = new Uint8Array((nSectors + 1) * SEC);
  // Header
  out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  u16(out, 0x18, 0x3e); u16(out, 0x1a, 3); u16(out, 0x1c, 0xfffe); u16(out, 0x1e, 9); u16(out, 0x20, 6);
  u32(out, 0x2c, 1); u32(out, 0x30, 1); u32(out, 0x38, 4096); u32(out, 0x3c, 0xfffffffe); u32(out, 0x40, 0); u32(out, 0x44, 0xfffffffe); u32(out, 0x48, 0);
  u32(out, 0x4c, 0); for (let k = 1; k < 109; k++) u32(out, 0x4c + k * 4, 0xffffffff);
  // FAT (sector 0)
  const fat = SEC; // offset of sector 0
  for (let k = 0; k < SEC / 4; k++) u32(out, fat + k * 4, 0xffffffff);
  u32(out, fat, 0xfffffffd); u32(out, fat + 4, 0xfffffffe);
  let sid = 2;
  const starts: number[] = [];
  for (const s of padded) { const n = s.data.length / SEC; starts.push(sid); for (let k = 0; k < n; k++) u32(out, fat + (sid + k) * 4, k === n - 1 ? 0xfffffffe : sid + k + 1); out.set(s.data, (sid + 1) * SEC); sid += n; }
  // Directory (sector 1)
  const dir = 2 * SEC;
  const entry = (i: number, name: string, type: number, left: number, right: number, child: number, start: number, size: number) => {
    const o = dir + i * 128;
    out.set(utf16(name), o); u16(out, o + 0x40, (name.length + 1) * 2); out[o + 0x42] = type; out[o + 0x43] = 1;
    u32(out, o + 0x44, left); u32(out, o + 0x48, right); u32(out, o + 0x4c, child); u32(out, o + 0x74, start); u32(out, o + 0x78, size);
  };
  entry(0, 'Root Entry', 5, 0xffffffff, 0xffffffff, 1, 0xfffffffe, 0);
  padded.forEach((s, i) => entry(i + 1, s.name, 2, 0xffffffff, i + 1 < padded.length ? i + 2 : 0xffffffff, 0xffffffff, starts[i], s.data.length));
  for (let i = padded.length + 1; i < 4; i++) { const o = dir + i * 128; u32(out, o + 0x44, 0xffffffff); u32(out, o + 0x48, 0xffffffff); u32(out, o + 0x4c, 0xffffffff); }
  return out;
}

function blipRecord(png: Uint8Array): Uint8Array {
  const payload = new Uint8Array(17 + png.length);
  payload.fill(0xab, 0, 16); payload[16] = 0xff; payload.set(png, 17);
  const rec = new Uint8Array(8 + payload.length);
  u16(rec, 0, 0x6e00); u16(rec, 2, 0xf01e); u32(rec, 4, payload.length); rec.set(payload, 8);
  return rec;
}

describe('Microsoft Publisher import', () => {
  const quill = () => { const text = utf16('Welcome to the newsletter\rSecond paragraph of the story here\r'); const b = new Uint8Array(text.length + 64); b.set(text, 32); return b; };
  const contents = () => { const r = blipRecord(pngBytes()); const b = new Uint8Array(r.length + 200); b.set(r, 100); return b; };
  const file = () => cfbFile([{ name: 'Quill', data: quill() }, { name: 'Contents', data: contents() }]);

  it('is identified by its Quill stream and read by the compound-file reader', () => {
    const b = file();
    const cfb = openCfb(b)!;
    expect(cfb.list()).toEqual(['Contents', 'Quill']);
    expect(cfb.read('Quill')!.length).toBeGreaterThanOrEqual(quill().length);
    expect(isMsPub(b)).toBe(true);
    expect(sniffFormat(b, 'flyer.pub')).toBe('pub');
    expect(sniffFormat(b, 'flyer.bin')).toBe('pub');
    expect(analyze(b, 'flyer.pub').primary.ext).toBe('pub');
    expect(formatFromName('x.pub')?.id).toBe('pub');
  });

  it('recovers the text and the pictures into a publication', async () => {
    const b = file();
    expect(quillText(quill()).map((p) => p.runs[0].text)).toEqual(['Welcome to the newsletter', 'Second paragraph of the story here']);
    expect(escherBlips(contents())).toHaveLength(1);
    const { pub, warnings, textOnly } = await importMsPub(b, 'flyer.pub');
    expect(textOnly).toBe(true);
    const text = pub.data.stories.map((s) => textOf(s.paras)).join('\n');
    expect(text).toContain('Welcome to the newsletter');
    expect(Object.keys(pub.media)).toHaveLength(1);
    expect(pub.pages.some((p) => p.items.some((e) => e.kind === 'picture'))).toBe(true);
    expect(warnings[0]).toMatch(/Publisher/);
    const r = await importPublication(b, 'flyer.pub');
    expect(r.format).toBe('pub');
    expect(r.pub.data.props.title).toBe('flyer');
  });
});

// ------------------------------------------------------------------------------------------
// InDesign binary, QuarkXPress, PageMaker

function latin(s: string, map: Record<string, number>): Uint8Array {
  return Uint8Array.from(s, (c) => map[c] ?? c.charCodeAt(0));
}

describe('binary layout files', () => {
  it('identifies and recovers an InDesign document', async () => {
    const head = [0x06, 0x06, 0xed, 0xf5, 0xd8, 0x1d, 0x46, 0xe5, 0xbd, 0x31, 0xef, 0xe7, 0xfe, 0x74, 0xb7, 0x1d];
    const text = utf16('The quick brown fox jumps over the lazy dog in InDesign.');
    const b = new Uint8Array(4096); b.set(head, 0); b.set(text, 500); b.set([1, 2, 3, 4, 5], 700);
    expect(isIndd(b)).toBe(true);
    expect(sniffFormat(b, 'x.indd')).toBe('indd');
    expect(analyze(b, 'x.indd').primary.ext).toBe('indd');
    const r = await importLegacyLayout(b, 'x.indd', 'indd');
    expect(textOf(r.pub.data.stories[0].paras)).toContain('quick brown fox');
    expect(r.textOnly).toBe(true);
    expect(r.warnings[0]).toMatch(/InDesign document/);
  });

  it('identifies and recovers a QuarkXPress document in Mac Roman', async () => {
    const b = new Uint8Array(4096);
    b.set([0, 0, 0x4d, 0x4d, 0x58, 0x50, 0x52, 0x33], 0); // MMXPR3
    b.set(latin('The café opens at noon, and the layout is from QuarkXPress 4.', { 'é': 0x8e }), 300);
    expect(isQxp(b)).toBe(true);
    expect(sniffFormat(b, 'x.qxd')).toBe('qxp');
    expect(analyze(b, 'x.qxd').primary.ext).toBe('qxp');
    const r = await importLegacyLayout(b, 'x.qxd', 'qxp');
    expect(textOf(r.pub.data.stories[0].paras)).toContain('café opens at noon');
    expect(r.warnings[0]).toMatch(/QuarkXPress/);
  });

  it('identifies and recovers a PageMaker publication', async () => {
    const b = new Uint8Array(4096);
    b.set([0, 0, 0xff, 0xff], 0);
    b.set(enc('Adobe PageMaker 6.5'), 64);
    b.set(latin('Garden club newsletter for the spring, written in PageMaker on Windows é.', { 'é': 0xe9 }), 1000);
    expect(isPageMaker(b)).toBe(true);
    expect(sniffFormat(b, 'x.pmd')).toBe('pmd');
    expect(analyze(b, 'x.pmd').primary.ext).toBe('pmd');
    const r = await importLegacyLayout(b, 'x.pmd', 'pmd');
    expect(textOf(r.pub.data.stories[0].paras)).toContain('Garden club newsletter');
    expect(textOf(r.pub.data.stories[0].paras)).toContain('é');
  });

  it('has text run helpers that drop binary noise', () => {
    const b = new Uint8Array(200);
    b.set(enc('ABCDEFGHIJKLMNOP'), 0);
    b.set(enc('A real sentence with several words in it.'), 60);
    const runs = byteRuns(b, 'windows-1252', 12);
    expect(paragraphsFrom(runs).map((p) => p.runs[0].text)).toEqual(['A real sentence with several words in it.']);
    expect(utf16Runs(utf16('ab\rcd efgh'), 2)).toEqual(['ab', 'cd efgh']);
  });
});

// ------------------------------------------------------------------------------------------
// XPress Tags and MIF

describe('XPress Tags import', () => {
  const sample = '<v6.00><e0>\n@Headline=[S"","Headline"]<*C*p(0,0,0,30,6,6,g)z24f"Arial">\n@Headline:Spring <B>Issue<B>\n@$:Body <I>italic<I> and <z14>bigger<z12> text<\\n>second line café\n';
  const bytes = () => latin(sample, { 'é': 0x8e });

  it('decodes the header encoding and reads styles, paragraphs and runs', () => {
    expect(decodeXtg(bytes())).toContain('café');
    expect(sniffFormat(bytes(), 'story.xtg')).toBe('xtg');
    expect(analyze(bytes(), 'story.xtg').primary.ext).toBe('xtg');
    const { pub, warnings } = importXpressTags(bytes(), 'story.xtg');
    const st = pub.data.styles.para.find((s) => s.name === 'Headline')!;
    expect(st.align).toBe('ctr');
    expect(st.run?.size).toBe(24);
    expect(st.run?.font).toBe('Arial');
    expect(st.lineSpacing).toBe(30);
    expect(st.spaceBefore).toBe(6);
    const paras = pub.data.stories[0].paras;
    expect(paras[0].style).toBe('Headline');
    expect(paras[0].runs.map((r) => r.text)).toEqual(['Spring ', 'Issue']);
    expect(paras[0].runs[1].b).toBe(true);
    expect(paras[1].style).toBe('Body');
    expect(paras[1].runs.find((r) => r.text === 'italic')?.i).toBe(true);
    expect(paras[1].runs.find((r) => r.text === 'bigger')?.size).toBe(14);
    expect(paras[1].runs.some((r) => r.br)).toBe(true);
    expect(paras[1].runs[paras[1].runs.length - 1].text).toBe('second line café');
    expect(warnings[0]).toMatch(/XPress Tags/);
  });

  it('opens through File ▸ Open', async () => {
    const r = await importPublication(bytes(), 'story.xtg');
    expect(r.format).toBe('xtg');
    expect(textOf(r.pub.data.stories[0].paras)).toContain('Spring Issue');
  });
});

describe('MIF import', () => {
  const sample = `<MIFFile 2015> # Generated by hand
<Units Uin>
<Document <DPageSize 8.5" 11.0">>
<PgfCatalog
 <Pgf <PgfTag \`Body'> <PgfAlignment LeftRight> <PgfLIndent 0.0"> <PgfFIndent 0.25"> <PgfSpBefore 0.0 pt> <PgfSpAfter 6.0 pt> <PgfLeading 2.0 pt>
  <PgfFont <FFamily \`Times'> <FSize 11.0 pt> <FWeight \`Regular'> <FAngle \`Regular'>>>
 <Pgf <PgfTag \`Heading'> <PgfAlignment Center> <PgfFont <FFamily \`Helvetica'> <FSize 18.0 pt> <FWeight \`Bold'>>>
>
<Page <PageType BodyPage> <PageNum \`1'>
 <TextRect <ID 7> <ShapeRect 1.0" 1.0" 6.5" 9.0"> <TRColumns 2> <TRColumnGap 0.25">>
>
<Page <PageType BodyPage> <PageNum \`2'>
 <TextRect <ID 8> <ShapeRect 1.0" 1.0" 6.5" 9.0">>
>
<TextFlow <TFTag \`A'> <TFAutoConnect Yes>
 <Para <PgfTag \`Heading'> <ParaLine <TextRectID 7> <String \`Spring Issue'>>>
 <Para <PgfTag \`Body'> <ParaLine <String \`Hello '> <Font <FTag \`'> <FWeight \`Bold'>> <String \`world'> <Font <FTag \`'>> <Char Tab> <String \`tabbed \\xe9 '>>
  <ParaLine <TextRectID 8> <String \`continued on page two'>>>
>
`;
  it('parses statements, units and flows into pages, frames and styles', async () => {
    const nodes = parseMif(sample);
    expect(nodes.map((n) => n.name)).toContain('TextFlow');
    expect(mifPoints(['8.5"'], 0)).toBeCloseTo(612);
    expect(mifPoints([6, 'pt'], 0)).toBe(6);
    expect(sniffFormat(enc(sample), 'book.mif')).toBe('mif');
    expect(analyze(enc(sample), 'book.mif').primary.ext).toBe('mif');
    const { pub, warnings } = importMif(sample, 'book.mif');
    expect(pub.size).toEqual({ w: 612, h: 792 });
    expect(pub.pages).toHaveLength(2);
    const f1 = pub.pages[0].items[0] as TextFrame;
    expect([f1.x, f1.y, f1.w, f1.h]).toEqual([72, 72, 468, 648]);
    expect(f1.columns).toBe(2);
    expect(f1.gutter).toBe(18);
    const f2 = pub.pages[1].items[0] as TextFrame;
    expect(f1.next).toBe(f2.id);
    expect(f2.story).toBe(f1.story);
    const body = pub.data.styles.para.find((s) => s.name === 'Body')!;
    expect(body.align).toBe('just');
    expect(body.indent).toBe(18);
    expect(body.spaceAfter).toBe(6);
    expect(body.lineSpacing).toBe(13);
    expect(body.run?.font).toBe('Times');
    const heading = pub.data.styles.para.find((s) => s.name === 'Heading')!;
    expect(heading.run?.b).toBe(true);
    const paras = pub.story(f1.story)!.paras;
    expect(paras[0].style).toBe('Heading');
    expect(textOf([paras[0]])).toBe('Spring Issue');
    expect(paras[1].runs.map((r) => r.text)).toEqual(['Hello ', 'world', '\t', 'tabbed é', 'continued on page two']);
    expect(paras[1].runs[1].b).toBe(true);
    expect(warnings.join(' ')).toMatch(/1 text flow/);
    const r = await importPublication(enc(sample), 'book.mif');
    expect(r.format).toBe('mif');
  });
});

describe('import commands and formats table', () => {
  it('registers the import commands on the File screen', () => {
    for (const id of ['file.import.idml', 'file.import.layoutFile', 'file.import.xpressTags', 'file.import.mif']) {
      const c = getCommand(id);
      expect(c, id).toBeTruthy();
      expect(c!.tab).toBe('Backstage');
    }
  });
  it('lists the new formats (IDML both ways, the rest import-only)', () => {
    for (const id of ['idml', 'indd', 'pub', 'qxp', 'pmd', 'mif', 'xtg']) {
      const f = FORMATS.find((x) => x.id === id);
      expect(f, id).toBeTruthy();
      expect(f!.canImport).toBe(true);
      expect(f!.canExport).toBe(id === 'idml');
    }
    expect(formatFromName('x.p65')?.id).toBe('pmd');
    expect(formatFromName('x.qxt')?.id).toBe('qxp');
  });
});
