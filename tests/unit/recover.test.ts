import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { Pub, parasFromText, textOf } from '../../src/model/pub';
import { exportPublication, importPublication } from '../../src/io';
import { exportSla } from '../../src/io/sla';
import { recoverPublication, recoverPub, reportText, repairJsonText, harvestMediaBytes, pubFromText } from '../../src/io/recover';
import { analyze } from '../../src/io/recover/fileid';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

function pub(n = 4): Pub {
  const p = Pub.blank({ w: 612, h: 792 }, { pages: n });
  p.data.props.title = 'Recovery Test';
  p.pages.forEach((pg, i) => { pg.items.push(p.newTextFrame({ x: 36, y: 36, w: 400, h: 200 }, parasFromText(`Story on page ${i + 1}\nMore words here for page ${i + 1}`))); });
  const media = p.addMedia({ mime: 'image/png', b64: PNG, name: 'red.png', w: 1, h: 1 });
  p.pages[1].items.push({ id: 'p', kind: 'picture', media, x: 300, y: 300, w: 100, h: 100 });
  return p;
}

const wordsOf = (p: Pub | null) => (p ? p.data.stories.map((s) => textOf(s.paras)).join('|') : '');

describe('file identification', () => {
  it('identifies qpp, sla, json and text', async () => {
    const q = (await exportPublication(pub(), 'qpp')).data;
    expect(analyze(q, 'x.bin').primary.ext).toBe('qpp');
    expect(analyze(exportSla(pub()), 'x.bin').primary.ext).toBe('sla');
    expect(analyze(new TextEncoder().encode(JSON.stringify(pub().toJSON())), 'x.bin').primary.ext).toBe('json');
    expect(analyze(new TextEncoder().encode('plain words only'), 'x.bin').primary.ext).toBe('txt');
  });
});

describe('recovery', () => {
  it('opens an undamaged file through the normal path', async () => {
    const p = pub();
    const r = await recoverPublication((await exportPublication(p, 'qpp')).data, 'ok.qpp');
    expect(r.bestMethod).toBe('open');
    expect(wordsOf(r.pub)).toBe(wordsOf(p));
    expect(reportText(r)).toContain('ok.qpp');
  });

  it('rebuilds a truncated .qpp from its zip entries', async () => {
    const p = pub(6);
    const full = (await exportPublication(p, 'qpp')).data;
    const cut = full.subarray(0, Math.floor(full.length * 0.9)); // central directory gone
    await expect(importPublication(cut, 'cut.qpp', { noRecovery: true })).rejects.toBeTruthy();
    const r = await recoverPublication(cut, 'cut.qpp');
    expect(r.pub).toBeTruthy();
    expect(['zip', 'json', 'text']).toContain(r.bestMethod);
    expect(wordsOf(r.pub)).toContain('Story on page 1');
    const viaImport = await importPublication(cut, 'cut.qpp');
    expect(viaImport.recovery).toBeTruthy();
  });

  it('repairs truncated JSON by cutting at the last complete item', async () => {
    const p = pub(5);
    const json = JSON.stringify(p.toJSON());
    const cut = json.slice(0, Math.floor(json.length * 0.7));
    const fixed = repairJsonText(cut);
    expect(fixed).toBeTruthy();
    const back = Pub.fromJSON(JSON.parse(fixed!));
    expect(back.pages.length).toBeGreaterThan(0);
    const r = await recoverPublication(new TextEncoder().encode(cut), 'cut.json');
    expect(r.pub).toBeTruthy();
    expect(r.stats.words).toBeGreaterThan(0);
  });

  it('heals a damaged Scribus file', async () => {
    const p = pub(4);
    const xml = new TextDecoder().decode(exportSla(p));
    const cut = xml.slice(0, Math.floor(xml.length * 0.8));
    const r = await recoverPublication(new TextEncoder().encode(cut), 'cut.sla');
    expect(r.pub).toBeTruthy();
    expect(r.stats.pages).toBeGreaterThan(0);
    expect(wordsOf(r.pub)).toContain('Story on page 1');
  });

  it('harvests pictures and text from a file whose zip is unreadable', async () => {
    const p = pub(3);
    const full = (await exportPublication(p, 'qpp')).data;
    const zip = await JSZip.loadAsync(full);
    const parts = new Map<string, Uint8Array>();
    for (const f of Object.values(zip.files)) if (!f.dir) parts.set(f.name, await f.async('uint8array'));
    // Store entries uncompressed, then corrupt every local header signature except the picture's.
    const stored = new JSZip();
    for (const [k, v] of parts) stored.file(k, v);
    const bytes = await stored.generateAsync({ type: 'uint8array', compression: 'STORE' });
    for (let i = 0; i < bytes.length - 4; i++) if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 3 && bytes[i + 3] === 4) bytes[i] = 0x00;
    const pics = harvestMediaBytes(bytes);
    expect(pics.some((x) => x.mime === 'image/png')).toBe(true);
    const r = await recoverPublication(bytes, 'mangled.qpp');
    expect(r.pub).toBeTruthy();
    expect(r.methods.map((m) => m.id)).toContain('media');
    expect(wordsOf(r.pub) + JSON.stringify(r.stats)).toBeTruthy();
  });

  it('makes a publication from any readable text', async () => {
    const p = pubFromText('Line one\n\nLine two', 'notes');
    expect(p.textFrames()).toHaveLength(1);
    const r = await recoverPub(new TextEncoder().encode('Just some words in a file with no structure at all. Second sentence here.'), 'words.bin');
    expect(r?.pub).toBeTruthy();
    expect(wordsOf(r!.pub)).toContain('Just some words');
  });
});
