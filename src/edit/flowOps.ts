/**
 * Autoflow: when a story does not fit its last frame, add linked frames (and pages) until it does.
 * Works on a Pub directly, so importers and commands share it.
 */
import { Pub, newId } from '../model/pub';
import type { Page, TextFrame } from '../model/types';
import { storyLayout } from '../render/flow';

/** Adds a page after `after` (or at the end) built on the same master. */
export function addPageAfter(pub: Pub, after?: Page): Page {
  const master = after ? after.master : pub.data.masters[0].id;
  const page: Page = { id: newId('pg'), master, items: [] };
  const i = after ? pub.pageIndex(after.id) : pub.pages.length - 1;
  pub.data.pages.splice(i + 1, 0, page);
  return page;
}

/** A frame filling the page's margins (and columns). */
export function marginFrame(pub: Pub, page: Page, storyId: string): TextFrame {
  const g = pub.geometry(page);
  let [mt, mr, mb, ml] = g.margins;
  if (pub.pageSide(pub.pageIndex(page.id)) === 'left') [ml, mr] = [mr, ml];
  return { id: newId('tf'), kind: 'text', story: storyId, x: ml, y: mt, w: Math.max(36, pub.size.w - ml - mr), h: Math.max(36, pub.size.h - mt - mb), insets: [0, 0, 0, 0], columns: g.columns, gutter: g.gutter };
}

/**
 * Flows the overset text of a frame's story into new frames on following pages (adding pages as
 * needed, up to `maxPages`). Returns the number of frames added.
 */
export function autoflowStory(pub: Pub, from: TextFrame, maxPages = 200): number {
  let added = 0;
  let last = pub.chainOf(from.story).slice(-1)[0] || from;
  for (let guard = 0; guard < maxPages; guard++) {
    pub.version++;
    const lay = storyLayout(pub, from.story);
    if (!lay || !lay.r.overset) break;
    const lastPage = pub.pageOfItem(last.id);
    const idx = lastPage ? pub.pageIndex(lastPage.id) : pub.pages.length - 1;
    let page = pub.pages[idx + 1];
    if (!page || page.items.some((e) => e.kind === 'text')) page = addPageAfter(pub, pub.pages[idx]);
    const f = marginFrame(pub, page, from.story);
    f.insets = last.insets || f.insets;
    f.columns = last.columns || f.columns;
    f.gutter = last.gutter ?? f.gutter;
    f.prev = last.id;
    last.next = f.id;
    page.items.push(f);
    last = f;
    added++;
  }
  pub.version++;
  return added;
}
