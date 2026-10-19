/**
 * In-place text editing: a contenteditable island laid over a text frame, bound to the frame's story.
 * The paragraphs are read back from the DOM on every change of formatting and when editing ends, so
 * the browser's own editing (typing, IME, spell checking, undo inside the island) is kept.
 *
 * The island shows the whole story (all linked frames) laid out in the frame's width; the page
 * renderer underneath draws the real line breaks once editing ends.
 */
import type { App } from '../app';
import type { Paragraph, ParaProps, Run, RunProps, TextFrame, Story } from '../model/types';
import { resolvePara, resolveRun, colorHex, runOverrides, paraOverrides } from '../model/styles';
import { bulletText } from '../render/text';
import { fontFamilyCss } from '../fonts';
import { splitRuns } from './ops';

let active: TextEditor | null = null;
export function activeTextEditor(): TextEditor | null { return active; }

interface Pos { para: number; off: number }

export class TextEditor {
  root: HTMLDivElement;
  onDone: ((commit: boolean) => void) | null = null;
  changed = false;
  private pendingRun: RunProps | null = null;

  constructor(public app: App, public frame: TextFrame, public story: Story, host: HTMLElement, box: { x: number; y: number; w: number; h: number; rot: number }, private selectAll = false) {
    const ins = frame.insets || [4, 4, 4, 4];
    this.root = document.createElement('div');
    this.root.className = 'qp-textedit';
    this.root.contentEditable = 'true';
    this.root.spellcheck = app.prefs.spellcheck;
    this.root.setAttribute('role', 'textbox');
    this.root.setAttribute('aria-multiline', 'true');
    this.root.setAttribute('aria-label', frame.name || 'Text');
    const s = this.root.style;
    s.left = `${box.x}px`; s.top = `${box.y}px`; s.width = `${box.w}px`; s.minHeight = `${box.h}px`;
    s.padding = `${ins[1]}px ${ins[2]}px ${ins[3]}px ${ins[0]}px`;
    if (box.rot) s.transform = `rotate(${box.rot}deg)`;
    if ((frame.columns || 1) > 1) { s.columnCount = String(frame.columns); s.columnGap = `${frame.gutter ?? 12}px`; }
    s.display = (frame.columns || 1) > 1 ? 'block' : 'flex'; s.flexDirection = 'column';
    s.justifyContent = frame.anchor === 'ctr' ? 'center' : frame.anchor === 'b' ? 'flex-end' : 'flex-start';
    this.render(story.paras.length ? story.paras : [{ style: 'Body', runs: [] }]);
    host.appendChild(this.root);
    this.root.addEventListener('keydown', (e) => this.onKey(e));
    this.root.addEventListener('input', (e) => this.onInput(e as InputEvent));
    this.root.addEventListener('paste', (e) => this.onPaste(e));
    active = this;
    requestAnimationFrame(() => {
      this.root.focus();
      if (this.selectAll) { const r = document.createRange(); r.selectNodeContents(this.root); setSel(r); }
      else this.setPos({ para: this.root.children.length - 1, off: Infinity });
    });
  }

  // ------------------------------------------------------------------------------------------
  // Model → DOM

  render(paras: Paragraph[], sel?: [Pos, Pos]): void {
    this.root.textContent = '';
    const pub = this.app.pub.data;
    let prevKey = '';
    let counter = 0;
    paras.forEach((p) => {
      const rs = resolvePara(pub, p);
      const pp = rs.props;
      const d = document.createElement('div');
      d.className = 'qp-tp';
      if (p.style) d.dataset.style = p.style;
      const ov = paraOverrides(p);
      if (Object.keys(ov).length) d.dataset.p = JSON.stringify(ov);
      const marL = pp.marL ?? 0, indent = pp.indent ?? 0;
      d.style.paddingLeft = `${marL}px`;
      d.style.paddingRight = `${pp.marR ?? 0}px`;
      d.style.textIndent = `${indent}px`;
      d.style.textAlign = ({ l: 'left', ctr: 'center', r: 'right', just: 'justify', justAll: 'justify' } as any)[pp.align || 'l'];
      if (pp.spaceBefore) d.style.marginTop = `${pp.spaceBefore}px`;
      if (pp.spaceAfter) d.style.marginBottom = `${pp.spaceAfter}px`;
      d.style.lineHeight = pp.lineSpacingPt ? `${pp.lineSpacing}px` : `${(pp.lineSpacing ?? 120) / 100}`;
      const base = rs.run;
      d.style.fontSize = `${base.size ?? 10.5}px`;
      d.style.fontFamily = fontFamilyCss(base.font || 'Tinos');
      d.style.color = colorHex(pub, base.color);
      if (base.b) d.style.fontWeight = 'bold';
      if (base.i) d.style.fontStyle = 'italic';
      const bullet = pp.bullet;
      const key = `${p.style || ''}:${bullet?.scheme || ''}`;
      if (bullet?.kind === 'num') counter = prevKey === key ? counter + 1 : 1;
      prevKey = bullet?.kind === 'num' ? key : '';
      const hasText = p.runs.some((r) => r.text);
      const bt = bullet && bullet.kind !== 'none' && hasText ? bulletText(bullet, Math.max(0, counter - 1)) : '';
      if (bt) { d.dataset.bullet = bt; d.style.setProperty('--qp-hang', `${Math.max(0, -indent)}px`); }
      for (const r of p.runs) {
        if (r.br) { d.appendChild(document.createElement('br')); continue; }
        if (!r.text) continue;
        const sp = document.createElement('span');
        sp.textContent = r.text;
        const props = runOverrides(r);
        if (r.field) (props as any).field = r.field;
        if (r.varName) (props as any).varName = r.varName;
        if (Object.keys(props).length) sp.dataset.r = JSON.stringify(props);
        this.styleSpan(sp, resolveRun(pub, {}, r), props);
        d.appendChild(sp);
      }
      if (p.end && Object.keys(p.end).length) d.dataset.end = JSON.stringify(p.end);
      if (!d.lastChild || d.lastChild.nodeName === 'BR') d.appendChild(document.createElement('br'));
      this.root.appendChild(d);
    });
    if (sel) this.setRange(sel[0], sel[1]);
  }

  private styleSpan(sp: HTMLElement, r: RunProps, ov: RunProps): void {
    const s = sp.style;
    const pub = this.app.pub.data;
    if (r.b) s.fontWeight = 'bold';
    if (ov.b === false) s.fontWeight = 'normal';
    if (r.i) s.fontStyle = 'italic';
    if (ov.i === false) s.fontStyle = 'normal';
    const dec = [r.u ? 'underline' : '', r.strike ? 'line-through' : ''].filter(Boolean).join(' ');
    if (dec) s.textDecoration = dec;
    if (r.size) s.fontSize = `${r.size}px`;
    if (r.font) s.fontFamily = fontFamilyCss(r.font);
    if (r.color) s.color = colorHex(pub, r.color);
    if (r.highlight) s.backgroundColor = colorHex(pub, r.highlight);
    if (r.baseline) { s.verticalAlign = r.baseline > 0 ? 'super' : 'sub'; s.fontSize = '0.67em'; }
    if (r.caps === 'all') s.textTransform = 'uppercase';
    if (r.caps === 'small') s.fontVariant = 'small-caps';
    if (r.spc) s.letterSpacing = `${r.spc}px`;
    if (r.link) { s.textDecoration = 'underline'; s.color = colorHex(pub, 'Primary'); }
    if ((ov as any).field) { s.backgroundColor = 'rgba(91,60,158,.12)'; sp.contentEditable = 'false'; }
  }

  // ------------------------------------------------------------------------------------------
  // DOM → model

  read(): Paragraph[] {
    const out: Paragraph[] = [];
    const blocks = [...this.root.childNodes];
    let loose: Node[] = [];
    const flushLoose = () => { if (loose.length) { const d = document.createElement('div'); loose.forEach((n) => d.appendChild(n.cloneNode(true))); out.push(this.readPara(d)); loose = []; } };
    for (const b of blocks) {
      if (b.nodeType === 1 && /^(DIV|P)$/.test((b as Element).tagName)) { flushLoose(); out.push(this.readPara(b as HTMLElement)); }
      else loose.push(b);
    }
    flushLoose();
    return out.length ? out : [{ style: 'Body', runs: [] }];
  }

  private readPara(d: HTMLElement): Paragraph {
    const p: Paragraph = { ...(d.dataset.style ? { style: d.dataset.style } : {}), runs: [], ...(d.dataset.p ? JSON.parse(d.dataset.p) : {}) };
    if (d.dataset.end) p.end = JSON.parse(d.dataset.end);
    const walk = (n: Node, props: RunProps) => {
      if (n.nodeType === 3) { const t = (n.nodeValue || '').replace(/ /g, ' ').replace(/​/g, ''); if (t) pushRun(p.runs, { ...props, text: t }); return; }
      if (n.nodeType !== 1) return;
      const e = n as HTMLElement;
      if (e.tagName === 'BR') { p.runs.push({ text: '', br: true }); return; }
      if (/^(DIV|P)$/.test(e.tagName) && e !== d) p.runs.push({ text: '', br: true });
      const np = { ...props, ...this.propsOf(e) };
      for (const c of e.childNodes) walk(c, np);
    };
    for (const c of d.childNodes) walk(c, {});
    while (p.runs.length && p.runs[p.runs.length - 1].br) p.runs.pop();
    if (!p.style && this.story.paras[0]?.style) p.style = this.story.paras[0].style;
    return p;
  }

  private propsOf(e: HTMLElement): RunProps {
    const r: RunProps & { field?: string; varName?: string } = e.dataset.r ? JSON.parse(e.dataset.r) : {};
    const t = e.tagName;
    if (t === 'B' || t === 'STRONG') r.b = true;
    if (t === 'I' || t === 'EM') r.i = true;
    if (t === 'U') r.u = true;
    if (t === 'S' || t === 'STRIKE' || t === 'DEL') r.strike = true;
    if (t === 'SUP') r.baseline = 30;
    if (t === 'SUB') r.baseline = -25;
    if (t === 'A' && e.getAttribute('href')) r.link = e.getAttribute('href')!;
    if (!e.dataset.r && e.style) {
      const s = e.style;
      if (s.fontWeight) r.b = s.fontWeight === 'bold' || +s.fontWeight >= 600;
      if (s.fontStyle) r.i = s.fontStyle === 'italic';
      if (/underline/.test(s.textDecoration)) r.u = true;
      if (/line-through/.test(s.textDecoration)) r.strike = true;
      const fs = /^([\d.]+)(px|pt)$/.exec(s.fontSize);
      if (fs) r.size = Math.round(+fs[1] * (fs[2] === 'px' ? 0.75 : 1) * 2) / 2;
      if (s.color && /^#|^rgb/.test(s.color)) r.color = toHex(s.color);
      if (s.fontFamily) r.font = s.fontFamily.split(',')[0].replace(/["']/g, '').trim();
    }
    return r;
  }

  // ------------------------------------------------------------------------------------------
  // Positions

  private posOf(node: Node, offset: number): Pos {
    const blocks = [...this.root.children];
    let block: Node | null = node;
    while (block && block.parentNode !== this.root) block = block.parentNode;
    let para = block ? blocks.indexOf(block as Element) : 0;
    if (para < 0) para = 0;
    if (node === this.root) { para = Math.min(offset, blocks.length - 1); return { para: Math.max(0, para), off: offset >= blocks.length ? Infinity : 0 }; }
    let off = 0;
    let found = false;
    const walk = (n: Node): boolean => {
      if (n === node && n.nodeType === 3) { off += offset; return true; }
      if (n === node) { for (let i = 0; i < offset && i < n.childNodes.length; i++) off += lengthOf(n.childNodes[i]); return true; }
      if (n.nodeType === 3) { off += (n.nodeValue || '').length; return false; }
      if ((n as Element).tagName === 'BR') { if (n.nextSibling || n.parentNode !== block) off += 1; return false; }
      for (const c of n.childNodes) if (walk(c)) return true;
      return false;
    };
    if (block) found = walk(block);
    return { para, off: found ? off : 0 };
  }

  private nodeAt(pos: Pos): [Node, number] {
    const block = this.root.children[Math.max(0, Math.min(pos.para, this.root.children.length - 1))];
    if (!block) return [this.root, 0];
    let left = pos.off;
    let res: [Node, number] | null = null;
    const walk = (n: Node): boolean => {
      if (n.nodeType === 3) {
        const len = (n.nodeValue || '').length;
        if (left <= len) { res = [n, left]; return true; }
        left -= len;
        return false;
      }
      if ((n as Element).tagName === 'BR') {
        if (left === 0) { res = [n.parentNode!, [...n.parentNode!.childNodes].indexOf(n as ChildNode)]; return true; }
        if (n.nextSibling) left -= 1;
        return false;
      }
      for (const c of n.childNodes) if (walk(c)) return true;
      return false;
    };
    walk(block);
    if (res) return res;
    const last = block.lastChild;
    if (last && last.nodeName === 'BR') return [block, block.childNodes.length - 1];
    return [block, block.childNodes.length];
  }

  getRange(): [Pos, Pos] | null {
    const s = window.getSelection();
    if (!s || !s.rangeCount) return null;
    const r = s.getRangeAt(0);
    if (!this.root.contains(r.startContainer)) return null;
    return [this.posOf(r.startContainer, r.startOffset), this.posOf(r.endContainer, r.endOffset)];
  }

  setRange(a: Pos, b: Pos): void {
    const r = document.createRange();
    const [n1, o1] = this.nodeAt(a);
    const [n2, o2] = this.nodeAt(b);
    try { r.setStart(n1, o1); r.setEnd(n2, o2); setSel(r); } catch { /* */ }
  }

  setPos(p: Pos): void { this.setRange(p, p); }

  // ------------------------------------------------------------------------------------------
  // Formatting

  /** Applies character formatting to the selection (or the word at the caret). */
  applyRun(props: Partial<RunProps> | ((cur: RunProps) => Partial<RunProps>)): void {
    const rng = this.getRange();
    const paras = this.read();
    if (!rng) return;
    let [a, b] = rng;
    let restore: [Pos, Pos] | null = null;
    if (a.para === b.para && a.off === b.off) {
      restore = [a, a];
      const text = paraText(paras[a.para]);
      let s = a.off, e = a.off;
      while (s > 0 && /\w/.test(text[s - 1])) s--;
      while (e < text.length && /\w/.test(text[e])) e++;
      if (s === e) {
        const p = paras[a.para];
        p.end = { ...(p.end || {}), ...(typeof props === 'function' ? props(p.end || {}) : props) };
        this.pendingRun = { ...(this.pendingRun || {}), ...(typeof props === 'function' ? props({}) : props) };
        this.render(paras, [a, a]);
        this.changed = true;
        return;
      }
      a = { para: a.para, off: s }; b = { para: a.para, off: e };
    }
    for (let pi = a.para; pi <= b.para; pi++) {
      const p = paras[pi];
      if (!p) continue;
      const from = pi === a.para ? a.off : 0;
      const to = pi === b.para ? b.off : Infinity;
      p.runs = splitRuns(p.runs, from, to, (r) => Object.assign(r, typeof props === 'function' ? props(r) : props));
      if (to === Infinity || to >= paraText(p).length) p.end = { ...(p.end || {}), ...(typeof props === 'function' ? props(p.end || {}) : props) };
    }
    this.render(paras, restore || [a, b]);
    this.changed = true;
  }

  /** Applies paragraph formatting to the paragraphs touched by the selection. */
  applyPara(props: Partial<ParaProps> | ((p: Paragraph) => Partial<Paragraph>)): void {
    const rng = this.getRange();
    const paras = this.read();
    const [a, b] = rng || [{ para: 0, off: 0 }, { para: paras.length - 1, off: Infinity }];
    for (let i = a.para; i <= b.para; i++) if (paras[i]) Object.assign(paras[i], typeof props === 'function' ? props(paras[i]) : props);
    this.render(paras, [a, b]);
    this.changed = true;
  }

  /** Inserts a run (a field, a symbol) at the caret. */
  insertRun(run: Run): void {
    const rng = this.getRange();
    const paras = this.read();
    const at = rng ? rng[0] : { para: paras.length - 1, off: Infinity };
    const p = paras[at.para];
    if (!p) return;
    const text = paraText(p);
    const off = Math.min(at.off, text.length);
    const [head, tail] = [splitRuns(p.runs, 0, off, () => undefined), splitRuns(p.runs, off, Infinity, () => undefined)];
    // splitRuns keeps all runs; rebuild as runs before/after the offset.
    const before: Run[] = [], after: Run[] = [];
    let pos = 0;
    for (const r of p.runs) {
      const len = r.br ? 1 : r.text.length;
      if (pos + len <= off) before.push(r);
      else if (pos >= off) after.push(r);
      else { before.push({ ...r, text: r.text.slice(0, off - pos) }); after.push({ ...r, text: r.text.slice(off - pos) }); }
      pos += len;
    }
    void head; void tail;
    p.runs = [...before, run, ...after];
    const np = { para: at.para, off: off + run.text.length };
    this.render(paras, [np, np]);
    this.changed = true;
  }

  caretRun(): RunProps {
    const rng = this.getRange();
    const paras = this.read();
    if (!rng) return {};
    const p = paras[rng[0].para];
    if (!p) return {};
    const base = resolvePara(this.app.pub.data, p).run;
    let off = rng[0].off;
    for (const r of p.runs) {
      const len = r.br ? 1 : r.text.length;
      if (off <= len && !r.br) return resolveRun(this.app.pub.data, base, r);
      off -= len;
    }
    return resolveRun(this.app.pub.data, base, p.end || {});
  }

  caretPara(): Partial<Paragraph> {
    const rng = this.getRange();
    const paras = this.read();
    return paras[rng?.[0].para ?? 0] || {};
  }

  selectedText(): string { return window.getSelection()?.toString() || ''; }

  /** Replaces the selection with text. */
  insertText(text: string): void { document.execCommand('insertText', false, text); }

  // ------------------------------------------------------------------------------------------
  // Input

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand('insertText', false, '\t');
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.finish(true); return; }
    e.stopPropagation();
  }

  private onInput(e: InputEvent): void {
    this.changed = true;
    if (this.pendingRun && e.inputType === 'insertText' && e.data) {
      const rng = this.getRange();
      if (rng) {
        const end = rng[0];
        const start = { para: end.para, off: Math.max(0, end.off - e.data.length) };
        const props = this.pendingRun;
        this.pendingRun = null;
        const paras = this.read();
        paras[end.para].runs = splitRuns(paras[end.para].runs, start.off, end.off, (r) => Object.assign(r, props));
        this.render(paras, [end, end]);
      }
    }
    if (e.inputType === 'insertText' && e.data) {
      if (this.app.prefs.typographerQuotes && (e.data === '"' || e.data === "'")) this.smartQuote(e.data);
      else if (/[\s.,;:!?)]/.test(e.data)) this.autoCorrect(e.data);
    }
    if (e.inputType === 'insertParagraph' || e.inputType === 'deleteContentBackward' || e.inputType === 'deleteContentForward') {
      const rng = this.getRange();
      const paras = this.read();
      if (e.inputType === 'insertParagraph' && rng) {
        // The new paragraph takes the "next style" of the previous one.
        const prev = paras[rng[0].para - 1];
        const cur = paras[rng[0].para];
        if (prev && cur) { const st = this.app.pub.paraStyle(prev.style); if (st?.next && !paraText(cur).trim()) cur.style = st.next; }
        if (this.app.prefs.autoLists) this.autoList(paras, rng);
      }
      this.render(paras, rng || undefined);
    }
  }

  private autoList(paras: Paragraph[], rng: [Pos, Pos]): void {
    const prev = paras[rng[0].para - 1];
    if (!prev || prev.bullet) return;
    const t = paraText(prev);
    const m = /^(\*|-|•)\s+/.exec(t) || /^(1)[.)]\s+/.exec(t);
    if (!m) return;
    const num = m[1] === '1';
    for (const p of [prev, paras[rng[0].para]]) {
      p.style = num ? 'Numbered List' : 'Bullet List';
      if (!this.app.pub.paraStyle(p.style)) { p.bullet = num ? { kind: 'num', scheme: t.includes(')') ? 'arabicParenR' : 'arabicPeriod' } : { kind: 'char', char: '•' }; p.marL = 14; p.indent = -10; }
    }
    prev.runs = splitRuns(prev.runs, 0, m[0].length, (r) => { r.text = ''; }).filter((r) => r.text || r.br);
  }

  private smartQuote(ch: string): void {
    const s = window.getSelection();
    if (!s || !s.rangeCount) return;
    const node = s.anchorNode;
    if (!node || node.nodeType !== 3) return;
    const text = node.nodeValue || '';
    const caret = s.anchorOffset;
    const before = text.slice(0, caret - 1);
    const open = !before.length || /[\s(\[{‘“-]$/.test(before);
    const rep = ch === '"' ? (open ? '“' : '”') : open ? '‘' : '’';
    node.nodeValue = before + rep + text.slice(caret);
    const r = document.createRange();
    r.setStart(node, caret); r.collapse(true); setSel(r);
    this.changed = true;
  }

  private autoCorrect(typed: string): void {
    const prefs = this.app.prefs;
    if (!prefs.autoCorrect) return;
    const s = window.getSelection();
    if (!s || !s.rangeCount) return;
    const node = s.anchorNode;
    if (!node || node.nodeType !== 3) return;
    const text = node.nodeValue || '';
    const caret = s.anchorOffset;
    const before = text.slice(0, caret - typed.length);
    const m = /(\S+)$/.exec(before);
    if (!m) return;
    const word = m[1];
    const rep = prefs.replacements[word] ?? prefs.replacements[word.toLowerCase()];
    let replacement: string | null = null;
    if (rep) replacement = /^[A-Z]/.test(word) && /^[a-z]/.test(rep) ? rep[0].toUpperCase() + rep.slice(1) : rep;
    else if (prefs.autoCapitalize && /^[a-z]/.test(word) && (before.length === word.length || /[.!?]\s+$/.test(before.slice(0, -word.length))) && /[\s.,;:!?]/.test(typed)) {
      const blockStart = this.getRange()?.[0].off === caret && before.length === word.length;
      if (blockStart || /[.!?]\s+$/.test(before.slice(0, -word.length))) replacement = word[0].toUpperCase() + word.slice(1);
    }
    if (replacement == null || replacement === word) return;
    const start = caret - typed.length - word.length;
    node.nodeValue = text.slice(0, start) + replacement + text.slice(caret - typed.length);
    const r = document.createRange();
    const pos = start + replacement.length + typed.length;
    r.setStart(node, Math.min(pos, node.nodeValue.length));
    r.collapse(true);
    setSel(r);
  }

  private onPaste(e: ClipboardEvent): void {
    const text = e.clipboardData?.getData('text/plain');
    if (text == null) return;
    e.preventDefault();
    document.execCommand('insertText', false, text.replace(/\r\n?/g, '\n'));
  }

  /** Ends editing; commit writes the paragraphs back to the story in one undoable step. */
  finish(commit: boolean): void {
    if (active !== this) return;
    active = null;
    this.onDone?.(commit);
  }

  destroy(): void {
    if (active === this) active = null;
    this.root.remove();
  }
}

// ------------------------------------------------------------------------------------------

function setSel(r: Range): void {
  const s = window.getSelection();
  if (!s) return;
  s.removeAllRanges();
  s.addRange(r);
}

function lengthOf(n: Node): number {
  if (n.nodeType === 3) return (n.nodeValue || '').length;
  if ((n as Element).tagName === 'BR') return n.nextSibling ? 1 : 0;
  let k = 0;
  for (const c of n.childNodes) k += lengthOf(c);
  return k;
}

export function paraText(p: Paragraph): string {
  return p.runs.map((r) => (r.br ? '\n' : r.text)).join('');
}

function sameProps(a: RunProps, b: RunProps): boolean {
  return JSON.stringify(runOverrides(a)) === JSON.stringify(runOverrides(b));
}

function pushRun(runs: Run[], r: Run): void {
  const last = runs[runs.length - 1];
  if (last && !last.br && !r.br && !last.field && !r.field && sameProps(last, r)) last.text += r.text;
  else runs.push(r);
}

function toHex(c: string): string {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  if (m) return '#' + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, '0')).join('').toUpperCase();
  return c.startsWith('#') ? c.toUpperCase() : c;
}

export { splitRuns };
