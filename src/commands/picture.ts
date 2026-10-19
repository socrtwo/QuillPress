/** Picture tab: adjustments, fitting and cropping, placing and replacing, saving, information, compression. */
import { def } from './registry';
import type { App } from '../app';
import type { PictureFrame } from '../model/types';
import { UNITS } from '../model/types';
import { selection, edit, setBox } from '../edit/ops';
import { openDialog, toast } from '../ui/dialog';
import { pickFile } from '../ui/dom';
import { IMAGE_ACCEPT, mediaFromBytes } from '../io/images';
import { unb64, b64 } from '../io/xml';

const u = (app: App) => UNITS[app.prefs.unit];
const toU = (app: App, pt: number) => +(pt / u(app).pt).toFixed(u(app).digits);

function pictures(app: App): PictureFrame[] { return selection(app).filter((e): e is PictureFrame => e.kind === 'picture'); }
const hasPic = (app: App) => pictures(app).length > 0;
const hasMedia = (app: App) => pictures(app).some((p) => p.media);

function patch(app: App, label: string, fn: (p: PictureFrame) => void): void {
  const ps = pictures(app);
  if (!ps.length) { toast('Select a picture first.'); return; }
  edit(app, label, () => ps.forEach(fn));
}

/** Picture size in points at its own resolution (or 72 dpi). */
function naturalSize(app: App, p: PictureFrame): { w: number; h: number; dpi: number } | null {
  const m = p.media ? app.pub.media[p.media] : undefined;
  if (!m?.w || !m.h) return null;
  const dpi = m.mime === 'image/svg+xml' ? 72 : m.dpi || 72;
  return { w: (m.w * 72) / dpi, h: (m.h * 72) / dpi, dpi };
}

/** Effective resolution of the picture as placed (pixels per inch across the frame). */
export function effectiveDpi(app: App, p: PictureFrame): number | null {
  const m = p.media ? app.pub.media[p.media] : undefined;
  if (!m?.w || !m.h || m.mime === 'image/svg+xml') return null;
  const crop = p.crop || [0, 0, 0, 0];
  const cw = m.w * (1 - crop[0] - crop[2]), ch = m.h * (1 - crop[1] - crop[3]);
  const fit = p.fit || 'fill';
  if (fit === 'none' && p.pos) return (72 / p.pos.scale);
  const sx = cw / (p.w / 72), sy = ch / (p.h / 72);
  return fit === 'fill' ? Math.min(sx, sy) : fit === 'fit' ? Math.max(sx, sy) : fit === 'stretch' ? Math.min(sx, sy) : 72;
}

const adjCmd = (id: string, key: 'brightness' | 'contrast' | 'saturation', label: string, icon: string) => ({
  id, label, icon, tab: 'Picture', group: 'Adjust', kind: 'size' as const, edits: true, isEnabled: hasMedia,
  tip: `${label} of the selected picture (−100 to 100)`,
  value: (app: App) => pictures(app)[0]?.[key] ?? 0,
  menu: () => [-50, -25, -10, 0, 10, 25, 50].map((v) => ({ id, arg: v, label: v === 0 ? 'Normal' : `${v > 0 ? '+' : ''}${v}%` })),
  run: (app: App, v?: number | string) => { const n = parseFloat(String(v)); if (isNaN(n)) return; patch(app, label, (p) => { p[key] = n === 0 ? undefined : Math.max(-100, Math.min(100, n)); }); },
});

async function placeInto(app: App, frames: PictureFrame[], label: string): Promise<void> {
  const files = await pickFile(IMAGE_ACCEPT, frames.length > 1);
  if (!files.length) return;
  const pub = app.pub;
  const ids: string[] = [];
  for (const [i, f] of files.entries()) {
    let m;
    try { m = await mediaFromBytes(new Uint8Array(await f.arrayBuffer()), f.name); } catch (e: any) { toast(`${f.name}: ${e?.message || e}`); continue; }
    ids.push(pub.addMedia(m));
    if (i >= frames.length) break;
  }
  if (!ids.length) return;
  edit(app, label, () => { frames.forEach((p, i) => { const id = ids[i] ?? ids[ids.length - 1]; p.media = id; p.src = pub.media[id].name; p.crop = undefined; p.pos = undefined; if (!p.fit) p.fit = 'fill'; }); });
}

def([
  adjCmd('picture.brightness', 'brightness', 'Brightness', 'brightness_6'),
  adjCmd('picture.contrast', 'contrast', 'Contrast', 'contrast'),
  adjCmd('picture.saturation', 'saturation', 'Saturation', 'invert_colors'),
  { id: 'picture.grayscale', label: 'Grayscale', icon: 'filter_b_and_w', tab: 'Picture', group: 'Adjust', kind: 'toggle', edits: true, isEnabled: hasMedia, isActive: (app) => !!pictures(app)[0]?.grayscale, run: (app) => { const on = !!pictures(app)[0]?.grayscale; patch(app, 'Grayscale', (p) => { p.grayscale = on ? undefined : true; }); } },
  { id: 'picture.reset', label: 'Reset Picture', icon: 'restart_alt', tab: 'Picture', group: 'Adjust', edits: true, isEnabled: hasPic, tip: 'Remove adjustments, cropping and fitting changes', run: (app) => patch(app, 'Reset Picture', (p) => { delete p.brightness; delete p.contrast; delete p.saturation; delete p.grayscale; delete p.crop; delete p.pos; p.fit = 'fill'; }) },
  {
    id: 'picture.fitting', label: 'Fitting', icon: 'fit_screen', tab: 'Picture', group: 'Fitting', kind: 'menu', edits: true, isEnabled: hasPic, origin: 'Frame fitting options (page layout programs)',
    menu: (app) => { const f = pictures(app)[0]?.fit || 'fill'; return [{ id: 'picture.fillFrame', label: 'Fill Frame Proportionally', icon: 'crop_free', checked: f === 'fill' }, { id: 'picture.fitProportionally', label: 'Fit Content Proportionally', icon: 'fit_screen', checked: f === 'fit' }, { id: 'picture.fitting', arg: 'stretch', label: 'Stretch to Fill', icon: 'open_in_full', checked: f === 'stretch' }, { id: 'picture.centerInFrame', label: 'Actual Size, Centered', icon: 'center_focus_strong', checked: f === 'none' }, { id: 'picture.fitting', arg: 'tile', label: 'Tile', icon: 'grid_on', checked: f === 'tile' }, { separator: true }, { id: 'picture.fitFrameToPicture', label: 'Fit Frame to Picture', icon: 'aspect_ratio' }, { id: 'picture.crop', label: 'Crop…', icon: 'crop' }]; },
    run: (app, fit?: PictureFrame['fit']) => { if (!fit) { app.exec('picture.fillFrame'); return; } patch(app, 'Fitting', (p) => { p.fit = fit; if (fit !== 'none') delete p.pos; }); },
  },
  { id: 'picture.fillFrame', label: 'Fill Frame', icon: 'crop_free', tab: 'Picture', group: 'Fitting', edits: true, isEnabled: hasPic, tip: 'Scale the picture to cover the frame, cropping what does not fit', run: (app) => patch(app, 'Fill Frame', (p) => { p.fit = 'fill'; delete p.pos; }) },
  { id: 'picture.fitProportionally', label: 'Fit Proportionally', icon: 'fit_screen', tab: 'Picture', group: 'Fitting', edits: true, isEnabled: hasPic, tip: 'Scale the whole picture inside the frame', run: (app) => patch(app, 'Fit Proportionally', (p) => { p.fit = 'fit'; delete p.pos; }) },
  {
    id: 'picture.fitFrameToPicture', label: 'Fit Frame to Picture', icon: 'aspect_ratio', tab: 'Picture', group: 'Fitting', edits: true, isEnabled: hasMedia,
    tip: 'Resize the frame to the picture\'s proportions (at the current width)',
    run: (app) => patch(app, 'Fit Frame to Picture', (p) => { const n = naturalSize(app, p); if (!n) return; const crop = p.crop || [0, 0, 0, 0]; const w = n.w * (1 - crop[0] - crop[2]), h = n.h * (1 - crop[1] - crop[3]); setBox(p, { h: (p.w * h) / w }); p.fit = 'fill'; delete p.pos; }),
  },
  {
    id: 'picture.actualSize', label: 'Frame to Actual Size', icon: 'photo_size_select_actual', tab: 'Picture', group: 'Fitting', edits: true, isEnabled: hasMedia,
    tip: 'Resize the frame to the picture\'s own size at its resolution',
    run: (app) => patch(app, 'Actual Size', (p) => { const n = naturalSize(app, p); if (!n) return; setBox(p, { w: n.w, h: n.h }); p.fit = 'fill'; delete p.crop; delete p.pos; }),
  },
  {
    id: 'picture.crop', label: 'Crop…', icon: 'crop', tab: 'Picture', group: 'Fitting', edits: true, isEnabled: hasMedia,
    tip: 'Trim the picture\'s edges (percent of each side); the frame keeps its size',
    run: async (app) => {
      const p = pictures(app)[0]; if (!p) return;
      const c = p.crop || [0, 0, 0, 0];
      const r = await openDialog({ title: 'Crop', fields: [{ key: 'l', label: 'Left (%)', type: 'number', min: 0, max: 95, value: Math.round(c[0] * 100), half: true }, { key: 't', label: 'Top (%)', type: 'number', min: 0, max: 95, value: Math.round(c[1] * 100), half: true }, { key: 'r', label: 'Right (%)', type: 'number', min: 0, max: 95, value: Math.round(c[2] * 100), half: true }, { key: 'b', label: 'Bottom (%)', type: 'number', min: 0, max: 95, value: Math.round(c[3] * 100), half: true }], validate: (v) => (+v.l + +v.r >= 100 || +v.t + +v.b >= 100 ? 'The crop would remove the whole picture.' : null) });
      if (!r) return;
      const crop: [number, number, number, number] = [+r.l / 100, +r.t / 100, +r.r / 100, +r.b / 100];
      patch(app, 'Crop', (x) => { x.crop = crop.some((v) => v > 0) ? crop : undefined; });
    },
  },
  {
    id: 'picture.cropToFrame', label: 'Crop to Frame Proportions', icon: 'crop_5_4', tab: 'Picture', group: 'Fitting', edits: true, isEnabled: hasMedia,
    tip: 'Set the crop so the picture matches the frame exactly without distortion (no hidden area)',
    run: (app) => patch(app, 'Crop to Frame', (p) => { const n = naturalSize(app, p); if (!n) return; const pr = n.w / n.h, fr = p.w / p.h; if (pr > fr) { const k = (1 - fr / pr) / 2; p.crop = [k, 0, k, 0]; } else { const k = (1 - pr / fr) / 2; p.crop = [0, k, 0, k]; } p.fit = 'stretch'; delete p.pos; }),
  },
  { id: 'picture.centerInFrame', label: 'Center in Frame', icon: 'center_focus_strong', tab: 'Picture', group: 'Fitting', edits: true, isEnabled: hasPic, tip: 'Show the picture at its own size, centered in the frame', run: (app) => patch(app, 'Center in Frame', (p) => { const n = naturalSize(app, p); p.fit = 'none'; p.pos = { x: n ? (p.w - n.w) / 2 : 0, y: n ? (p.h - n.h) / 2 : 0, scale: 1 }; }) },
  {
    id: 'picture.scale', label: 'Picture Scale…', icon: 'zoom_in', tab: 'Picture', group: 'Fitting', edits: true, isEnabled: hasMedia,
    tip: 'Scale and offset of the picture inside the frame',
    run: async (app) => {
      const p = pictures(app)[0]; if (!p) return;
      const r = await openDialog({ title: 'Picture Scale', fields: [{ key: 's', label: 'Scale (%)', type: 'number', min: 1, max: 2000, value: Math.round((p.pos?.scale ?? 1) * 100) }, { key: 'x', label: `Offset X (${u(app).label})`, type: 'number', step: 0.01, value: toU(app, p.pos?.x ?? 0), half: true }, { key: 'y', label: `Offset Y (${u(app).label})`, type: 'number', step: 0.01, value: toU(app, p.pos?.y ?? 0), half: true }] });
      if (!r) return;
      patch(app, 'Picture Scale', (x) => { x.fit = 'none'; x.pos = { x: (+r.x || 0) * u(app).pt, y: (+r.y || 0) * u(app).pt, scale: Math.max(0.01, (+r.s || 100) / 100) }; });
    },
  },
  { id: 'picture.place', label: 'Place Picture…', icon: 'add_photo_alternate', tab: 'Picture', group: 'Picture', keys: ['Mod-Shift-e'], edits: true, tip: 'Put a picture into the selected frame (or add one)', run: (app) => { const ps = pictures(app); if (!ps.length) { app.exec('insert.picture'); return; } void placeInto(app, ps, 'Place Picture'); } },
  { id: 'picture.change', label: 'Change Picture…', icon: 'swap_horiz', tab: 'Picture', group: 'Picture', edits: true, isEnabled: hasPic, tip: 'Replace the picture, keeping the frame and its fitting', run: (app) => { const ps = pictures(app); if (ps.length) void placeInto(app, ps, 'Change Picture'); } },
  {
    id: 'picture.saveAs', label: 'Save Picture As…', icon: 'download', tab: 'Picture', group: 'Picture', noRecord: true, isEnabled: hasMedia,
    run: async (app) => {
      const p = pictures(app).find((x) => x.media); if (!p?.media) return;
      const m = app.pub.media[p.media];
      const ext = (m.mime.split('/')[1] || 'bin').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
      const { saveAs } = await import('../platform/native');
      const r = await saveAs(new Blob([unb64(m.b64) as BlobPart], { type: m.mime }), m.name && /\.[a-z0-9]+$/i.test(m.name) ? m.name : `${p.name || 'picture'}.${ext}`);
      if (r) toast(`Saved ${r.name}`);
    },
  },
  {
    id: 'picture.info', label: 'Picture Information', icon: 'info', tab: 'Picture', group: 'Picture', noRecord: true, isEnabled: hasPic,
    run: async (app) => {
      const p = pictures(app)[0]; if (!p) return;
      const m = p.media ? app.pub.media[p.media] : undefined;
      const dpi = effectiveDpi(app, p);
      const kb = m ? Math.round((m.b64.length * 3) / 4 / 1024) : 0;
      await openDialog({ title: 'Picture Information', ok: 'Close', cancel: false, fields: [{ key: 'i', type: 'info', html: m ? `<table class="ql-table"><tr><td>File</td><td>${(m.name || '(pasted)').replace(/</g, '&lt;')}</td></tr><tr><td>Type</td><td>${m.mime}</td></tr><tr><td>Pixels</td><td>${m.w || '?'} × ${m.h || '?'}</td></tr><tr><td>Size</td><td>${kb} KB</td></tr><tr><td>Frame</td><td>${toU(app, p.w)} × ${toU(app, p.h)} ${u(app).label}</td></tr><tr><td>Effective resolution</td><td>${dpi ? `${Math.round(dpi)} ppi${dpi < 150 ? ' — low for print' : dpi < 250 ? ' — acceptable' : ' — good for print'}` : 'vector'}</td></tr><tr><td>Fitting</td><td>${p.fit || 'fill'}${p.crop ? ', cropped' : ''}</td></tr></table>` : '<p>This frame is empty. Double-click it (or Picture ▸ Place Picture) to put a picture in it.</p>' }] });
    },
  },
  {
    id: 'picture.compress', label: 'Compress Pictures…', icon: 'compress', tab: 'Picture', group: 'Picture', edits: true,
    tip: 'Re-encode the selected pictures (or all) as JPEG at a chosen resolution to make the file smaller',
    run: async (app) => {
      const pub = app.pub;
      const sel = pictures(app).filter((p) => p.media);
      const r = await openDialog({ title: 'Compress Pictures', fields: [{ key: 'which', label: 'Apply to', type: 'radio', options: [{ value: 'sel', label: `Selected pictures (${sel.length})` }, { value: 'all', label: `All pictures (${Object.keys(pub.media).length})` }], value: sel.length ? 'sel' : 'all' }, { key: 'ppi', label: 'Resolution', type: 'select', options: [{ value: '300', label: 'Print (300 ppi)' }, { value: '220', label: 'High quality screen (220 ppi)' }, { value: '150', label: 'Web (150 ppi)' }, { value: '96', label: 'Email (96 ppi)' }], value: '220' }, { key: 'q', label: 'JPEG quality (%)', type: 'number', min: 30, max: 100, value: 85 }, { key: 'png', label: 'Keep PNG and SVG as they are (transparency)', type: 'checkbox', value: true }], ok: 'Compress' });
      if (!r) return;
      const ids = r.which === 'sel' ? [...new Set(sel.map((p) => p.media!))] : Object.keys(pub.media);
      let saved = 0, n = 0;
      for (const id of ids) {
        const m = pub.media[id];
        if (!m || m.mime === 'image/svg+xml' || (r.png && m.mime === 'image/png') || m.mime === 'image/gif') continue;
        // Largest frame showing this picture decides the pixel size needed.
        let maxIn = 0;
        for (const o of [...pub.pages, ...pub.data.masters]) for (const e of o.items) if (e.kind === 'picture' && e.media === id) maxIn = Math.max(maxIn, e.w / 72, e.h / 72);
        const want = Math.max(64, Math.round((maxIn || 4) * +r.ppi));
        try {
          const img = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('decode')); im.src = pub.mediaUrl(id); });
          const k = Math.min(1, want / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
          const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
          const data = c.toDataURL('image/jpeg', (+r.q || 85) / 100).split(',')[1];
          const before = m.b64.length;
          if (data.length < before) { pub.media[id] = { ...m, mime: 'image/jpeg', b64: data, w: c.width, h: c.height, dpi: +r.ppi, name: m.name?.replace(/\.[^.]+$/, '') + '.jpg' }; saved += Math.round(((before - data.length) * 3) / 4); n++; }
        } catch { /* undecodable: skip */ }
      }
      if (n) { pub.changed(); app.tab.ui.invalidate(); }
      toast(n ? `Compressed ${n} picture(s), saving ${Math.round(saved / 1024)} KB.` : 'No picture could be made smaller.');
    },
  },
  {
    id: 'picture.toBase64', label: 'Copy Picture Data URL', icon: 'data_object', tab: 'Picture', group: 'Picture', noRecord: true, isEnabled: hasMedia, internal: true,
    run: async (app) => { const p = pictures(app).find((x) => x.media); if (!p?.media) return; const { writeClipboardText } = await import('../platform/native'); await writeClipboardText(app.pub.mediaUrl(p.media)); toast('Copied'); },
  },
]);

