/** Anchored objects: pictures, frames and shapes that travel with the text they are anchored in. */
import { def } from './registry';
import type { App } from '../app';
import type { AnchorOptions, Item, Paragraph, TextFrame } from '../model/types';
import { selection, edit, textTargets, newTextFrame, splitParagraph, removeAnchorRuns } from '../edit/ops';
import { activeTextEditor } from '../edit/textEdit';
import { storyLayout, anchorPointOf } from '../render/flow';
import { openDialog, toast } from '../ui/dialog';
import { pickFile } from '../ui/dom';
import { IMAGE_ACCEPT, mediaFromBytes, frameForMedia } from '../io/images';

type Mode = AnchorOptions['mode'];

const overlaps = (a: Item, b: Item) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const anchoredSel = (app: App) => app.selected.filter((e) => e.anchored);

/** Inserts a run at a character offset of a paragraph. */
export function insertRunAt(p: Paragraph, off: number, run: Paragraph['runs'][number]): void {
  const [a, b] = splitParagraph(p, off);
  p.runs = [...a.runs.filter((r) => r.text || r.br || r.field || r.anchor || r.footnote), run, ...b.runs.filter((r) => r.text || r.br || r.field || r.anchor || r.footnote)];
}

/**
 * Anchors objects in a story: at the caret of the text being edited, else at the start of the selected
 * frame's story, else in the text frame the object overlaps. Returns the number of objects anchored.
 */
export function anchorObjects(app: App, mode: Mode, ids?: string[], opts: Partial<AnchorOptions> = {}): number {
  const pub = app.pub;
  const o = app.owner;
  if (!o) return 0;
  const ed = activeTextEditor();
  let frame: TextFrame | undefined = ed ? ed.frame : textTargets(app)[0];
  let objects: Item[] = ids ? ids.map((id) => o.items.find((e) => e.id === id)).filter(Boolean) as Item[] : selection(app).filter((e) => e !== frame && !(e.kind === 'text' && e.story === frame?.story));
  if (!objects.length && frame && !ed) objects = [];
  if (!objects.length) { toast(ed ? 'Select the object to anchor first (click it, then click back in the text), or pass its id.' : 'Select the object to anchor (and the text frame it belongs in).'); return 0; }
  if (!frame) frame = o.items.find((e) => e.kind === 'text' && !objects.includes(e) && objects.some((x) => overlaps(e, x))) as TextFrame | undefined;
  if (!frame) { toast('Click inside the text where the object should be anchored, or select the text frame with it.'); return 0; }
  let pos = { para: 0, off: 0 };
  if (ed) { pos = ed.caretPos() || pos; app.tab.ui.commitText(); }
  const story = pub.story(frame.story);
  if (!story) return 0;
  const f = frame;
  pub.transact(`Anchor ${mode === 'inline' ? 'Inline' : mode === 'above' ? 'Above Line' : 'Object'}`, () => {
    const p = story.paras[Math.min(pos.para, story.paras.length - 1)] || story.paras[0];
    for (const e of objects) {
      if (e.anchored) removeAnchorRuns(app, [e.id]);
      const before = { x: e.x, y: e.y };
      e.anchored = { story: story.id, mode, ...(opts.valign ? { valign: opts.valign } : {}), ...(opts.align ? { align: opts.align } : {}), dx: opts.dx, dy: opts.dy };
      if (e.anchored.dx == null) delete e.anchored.dx;
      if (e.anchored.dy == null) delete e.anchored.dy;
      if (e.wrap && mode === 'inline') delete e.wrap;
      insertRunAt(p, Math.min(pos.off, p.runs.reduce((a, r) => a + (r.br ? 1 : r.text.length), 0)), { text: '￼', anchor: e.id });
      // Keep the object right after its frame in the stacking order.
      const i = o.items.indexOf(e), fi = o.items.indexOf(f);
      if (i >= 0 && fi >= 0 && i < fi) { o.items.splice(i, 1); o.items.splice(o.items.indexOf(f) + 1, 0, e); }
      if (mode === 'custom' && opts.dx == null) {
        // Keep the object where it is: measure the anchor point and store the offset from it.
        pub.version++;
        storyLayout(pub, story.id);
        const ap = anchorPointOf(pub, e.id);
        if (ap) { e.anchored.dx = Math.round((before.x - ap.x) * 100) / 100; e.anchored.dy = Math.round((before.y - ap.y) * 100) / 100; }
      }
    }
    pub.version++;
  });
  app.tab.ui.select(objects.map((e) => e.id));
  return objects.length;
}

def([
  {
    id: 'arrange.anchorInline', label: 'Anchor Inline', icon: 'format_image_left', tab: 'Arrange', group: 'Anchor', kind: 'toggle', edits: true, origin: 'Inline graphics (PageMaker, Ventura, InDesign anchored objects)',
    tip: 'The selected object sits in the text like a character and moves with it; its line grows to hold it',
    isActive: (app) => app.selected[0]?.anchored?.mode === 'inline',
    run: (app, ids?: string[]) => anchorObjects(app, 'inline', ids),
  },
  {
    id: 'arrange.anchorAbove', label: 'Anchor Above Line', icon: 'vertical_align_top', tab: 'Arrange', group: 'Anchor', kind: 'toggle', edits: true,
    tip: 'The selected object sits above the line it is anchored in and moves with the text',
    isActive: (app) => app.selected[0]?.anchored?.mode === 'above',
    run: (app, ids?: string[]) => anchorObjects(app, 'above', ids),
  },
  {
    id: 'arrange.anchorCustom', label: 'Anchor at Offset', icon: 'anchor', tab: 'Arrange', group: 'Anchor', kind: 'toggle', edits: true,
    tip: 'The selected object keeps its distance from a point in the text and moves when that text moves',
    isActive: (app) => app.selected[0]?.anchored?.mode === 'custom',
    run: (app, ids?: string[]) => anchorObjects(app, 'custom', ids),
  },
  {
    id: 'arrange.releaseAnchor', label: 'Release Anchor', icon: 'link_off', tab: 'Arrange', group: 'Anchor', edits: true, isEnabled: (app) => anchoredSel(app).length > 0,
    tip: 'The object stays where it is and no longer moves with the text',
    run: (app) => { const els = anchoredSel(app); if (!els.length) { toast('Select an anchored object first.'); return; } edit(app, 'Release Anchor', () => { for (const e of els) delete e.anchored; removeAnchorRuns(app, els.map((e) => e.id)); }); },
  },
  {
    id: 'arrange.anchorOptions', label: 'Anchor Options…', icon: 'tune', tab: 'Arrange', group: 'Anchor', edits: true, isEnabled: (app) => anchoredSel(app).length > 0,
    run: async (app, arg?: Partial<AnchorOptions>) => {
      const els = anchoredSel(app);
      if (!els.length) { toast('Select an anchored object first.'); return; }
      const a = els[0].anchored!;
      let r: any = arg;
      if (!r) {
        r = await openDialog({ title: 'Anchor Options', fields: [
          { key: 'mode', label: 'Position', type: 'select', options: [{ value: 'inline', label: 'Inline with the text' }, { value: 'above', label: 'Above the line' }, { value: 'custom', label: 'At an offset from the anchor' }], value: a.mode },
          { key: 'valign', label: 'Inline alignment', type: 'select', options: [{ value: 'baseline', label: 'Bottom on the baseline' }, { value: 'ctr', label: 'Centered on the line' }, { value: 'top', label: 'Top with the ascenders' }], value: a.valign || 'baseline', visibleIf: (v) => v.mode === 'inline' },
          { key: 'align', label: 'Horizontal alignment', type: 'select', options: [{ value: 'l', label: 'Left' }, { value: 'ctr', label: 'Center' }, { value: 'r', label: 'Right' }], value: a.align || 'l', visibleIf: (v) => v.mode === 'above' },
          { key: 'dx', label: 'Offset X (pt)', type: 'number', step: 0.5, value: a.dx ?? 0, half: true, visibleIf: (v) => v.mode !== 'inline' },
          { key: 'dy', label: 'Offset Y (pt)', type: 'number', step: 0.5, value: a.dy ?? (a.mode === 'above' ? 4 : 0), half: true, visibleIf: (v) => v.mode !== 'inline' },
        ], help: 'Inline objects widen their line; objects above the line push the text down; offset objects keep their distance from the anchor point (drag the object to change it).' });
        if (!r) return;
      }
      edit(app, 'Anchor Options', () => {
        for (const e of els) {
          const an = e.anchored!;
          an.mode = r.mode || an.mode;
          if (an.mode === 'inline') { an.valign = r.valign && r.valign !== 'baseline' ? r.valign : undefined; delete an.dx; delete an.dy; delete an.align; }
          else { an.dx = +r.dx || 0; an.dy = +r.dy || 0; if (an.mode === 'above') an.align = r.align && r.align !== 'l' ? r.align : undefined; else delete an.align; delete an.valign; }
          if (an.valign === undefined) delete an.valign;
        }
      });
    },
  },
  {
    id: 'insert.inlinePicture', label: 'Inline Picture', icon: 'add_photo_alternate', tab: 'Insert', group: 'Text', edits: true, origin: 'Inline graphics (PageMaker, Ventura Publisher)',
    tip: 'Place a picture in the text at the caret; it moves with the text like a character',
    run: async (app, file?: File) => {
      const ed = activeTextEditor();
      const frame = ed?.frame || textTargets(app)[0];
      if (!frame) { toast('Click in the text where the picture should go first.'); return; }
      const f = file || (await pickFile(IMAGE_ACCEPT))[0];
      if (!f) return;
      let m;
      try { m = await mediaFromBytes(new Uint8Array(await f.arrayBuffer()), f.name); } catch (e: any) { toast(`${f.name}: ${e?.message || e}`); return; }
      const id = app.pub.addMedia(m);
      const maxW = Math.max(24, (frame.w - 8) / Math.max(1, frame.columns || 1) * 0.5);
      const nat = m.w && m.h ? { w: (m.w * 72) / (m.dpi || 96), h: (m.h * 72) / (m.dpi || 96) } : { w: maxW, h: maxW * 0.75 };
      const k = Math.min(1, maxW / nat.w, 120 / nat.h);
      const pic = frameForMedia(id, m, { x: frame.x, y: frame.y, w: nat.w * k, h: nat.h * k });
      const o = app.owner; if (!o) return;
      app.pub.transact('Inline Picture', () => { o.items.splice(o.items.indexOf(frame) + 1, 0, pic); });
      anchorObjects(app, 'inline', [pic.id]);
    },
  },
  {
    id: 'insert.inlineFrame', label: 'Inline Text Frame', icon: 'text_snippet', tab: 'Insert', group: 'Text', edits: true,
    tip: 'A small text frame set in the text at the caret, moving with it (for a boxed term, a formula, a badge)',
    run: (app, text?: string) => {
      const ed = activeTextEditor();
      const frame = ed?.frame || textTargets(app)[0];
      if (!frame) { toast('Click in the text where the frame should go first.'); return; }
      const nf = newTextFrame(app, text || 'Inline', { x: frame.x, y: frame.y, w: 90, h: 24 });
      nf.name = 'Inline frame'; nf.insets = [3, 2, 3, 2]; nf.ostyle = 'Sidebar';
      const o = app.owner; if (!o) return;
      app.pub.transact('Inline Text Frame', () => { o.items.splice(o.items.indexOf(frame) + 1, 0, nf); });
      anchorObjects(app, 'inline', [nf.id]);
    },
  },
]);
