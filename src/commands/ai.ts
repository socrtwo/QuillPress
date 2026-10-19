/**
 * AI tab: setup, providers, several AIs, and the publishing features (draft a publication, write and
 * rewrite stories, headlines, pull quotes, captions, alt text, copy fitting, layout suggestions,
 * assistant). Only the text a command needs is sent, results are previewed, and changes apply as one
 * undoable step.
 */
import { def, type MenuEntry } from './registry';
import type { App } from '../app';
import type { Page, Paragraph, PictureFrame, TextFrame } from '../model/types';
import { Pub, newId } from '../model/pub';
import { aiSettings, saveAiSettings, resolveProvider } from '../ai/store';
import { providerById } from '../ai/providers';
import { chat, activeEnsemble, type ChatMessage, type ContentPart } from '../ai/client';
import { outcomeLine, type EnsembleMode } from '../ai/ensemble';
import { PRESS_SYSTEM, TEXT_TASKS, draftPublicationPrompt, draftStoryPrompt, parseDraft, parseJsonLoose, cleanText, linesOf, type DraftPublication } from '../ai/press';
import { edit, textTargets, insertItem, placeNew, selection } from '../edit/ops';
import { activeTextEditor, paraText } from '../edit/textEdit';
import { storyLayout, oversetFrames } from '../render/flow';
import { addPageAfter } from '../edit/flowOps';
import { openDialog, toast, confirmDialog, promptDialog } from '../ui/dialog';
import { h } from '../ui/dom';
import { effectiveDpi } from './picture';

// ------------------------------------------------------------------------------------------
// Readiness, privacy, requests

const cloudId = (id: string) => { const p = providerById(id); return !!p && p.kind !== 'local' && p.kind !== 'builtin'; };
function aiRecipients(): string[] {
  const plan = activeEnsemble();
  if (!plan) { const a = aiSettings().active; return a ? [a] : []; }
  return [...new Set([...plan.members.map((m) => m.provider), plan.master.provider])];
}
const names = (ids: string[]) => { const n = ids.map((id) => providerById(id)?.name || id); return n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`; };

export async function ensureAiReady(app: App, reason = 'This command needs an AI provider. Choose one below; free options, including one that runs on this device, are at the top.'): Promise<boolean> {
  const s = aiSettings();
  if (!s.enabled) { toast('AI features are turned off (AI ▸ AI Settings).', { action: 'Settings', onAction: () => app.exec('ai.settings') }); return false; }
  if (!(s.active && (await resolveProvider()))) {
    const { openAiSetup } = await import('../ui/aiWizard');
    if (!(await openAiSetup(app, { reason }))) return false;
  }
  const ids = aiRecipients().filter((id) => cloudId(id) && !aiSettings().privacyAck.includes(id));
  if (!ids.length) return true;
  const free = ids.some((id) => providerById(id)?.free === 'free');
  const ok = await confirmDialog('Sending Text to an AI Service', `AI commands send only the publication text they need directly from this device to ${names(ids)}. QuillPress has no server and keeps no copy. The service's terms and privacy policy apply${free ? ', and free tiers may use what you send to improve their models' : ''}. For confidential publications, use the on-device model. Continue?`, 'Continue', 'Cancel');
  if (ok) saveAiSettings((x) => { for (const id of ids) if (!x.privacyAck.includes(id)) x.privacyAck.push(id); });
  return ok;
}

let controller: AbortController | null = null;

function system(): string {
  const s = aiSettings();
  return [PRESS_SYSTEM, s.language && s.language !== 'auto' ? `Write in ${s.language}.` : '', s.styleGuide ? `Style guide: ${s.styleGuide}` : ''].filter(Boolean).join('\n');
}

/** Sends a prompt and returns the answer text (with a status toast while waiting). */
export async function ask(app: App, prompt: string | ContentPart[], opts: { tier?: 'fast' | 'quality'; maxTokens?: number } = {}): Promise<string | null> {
  if (!(await ensureAiReady(app))) return null;
  controller?.abort();
  controller = new AbortController();
  const ctl = controller;
  app.ui.status?.('● AI is working… (AI ▸ Stop AI to cancel)');
  try {
    const messages: ChatMessage[] = [{ role: 'system', content: system() }, { role: 'user', content: prompt }];
    const r = await chat({ messages, tier: opts.tier || 'quality', maxTokens: opts.maxTokens || 2000, signal: ctl.signal, onStatus: (t) => app.ui.status?.(`● ${t}`) });
    if (r.ensemble && aiSettings().ensemble.showDeliberation) toast(outcomeLine(r.ensemble, (id) => providerById(id)?.name || id), { ms: 8000 });
    if (r.truncated) toast('The AI answer was cut short; the result may be incomplete.');
    return r.text;
  } catch (e: any) {
    if (e?.code === 'aborted' || ctl.signal.aborted) toast('AI stopped.');
    else toast(`AI: ${e?.message || e}`, { ms: 7000 });
    return null;
  } finally {
    if (controller === ctl) controller = null;
    app.ui.status?.('');
  }
}

async function previewText(title: string, text: string, ok = 'Apply'): Promise<string | null> {
  const r = await openDialog({ title, wide: true, ok, fields: [{ key: 't', label: 'Result (you can edit it before applying)', type: 'textarea', rows: Math.min(18, Math.max(5, text.split('\n').length + 1)), value: text }] });
  return r ? String(r.t) : null;
}

async function pickLine(title: string, lines: string[], ok: string): Promise<string | null> {
  if (!lines.length) { toast('The AI answer was empty.'); return null; }
  const r = await openDialog({ title, wide: true, ok, fields: [{ key: 'l', label: 'Choose one (or edit it)', type: 'radio', options: lines.map((l) => ({ value: l, label: l })), value: lines[0] }, { key: 'e', label: 'Edited text (optional)', type: 'text', value: '' }] });
  if (!r) return null;
  return String(r.e || r.l);
}

// ------------------------------------------------------------------------------------------
// Publication text

function pubText(app: App, maxChars = 24000): string {
  const pub = app.pub;
  const out: string[] = [];
  pub.pages.forEach((p, i) => {
    const stories = p.items.filter((e): e is TextFrame => e.kind === 'text' && !e.prev).map((f) => pub.story(f.story)).filter(Boolean);
    const text = stories.map((s) => s!.paras.map(paraText).filter((t) => t.trim()).join('\n')).filter(Boolean).join('\n\n');
    if (text) out.push(`Page ${i + 1}:\n${text}`);
  });
  return out.join('\n\n').slice(0, maxChars);
}

/** The text a writing command works on: selected text being edited, the selected frame's story, or nothing. */
function textInput(app: App): { text: string; story?: string; apply: (lines: string[], label: string) => void } | null {
  const ed = activeTextEditor();
  if (ed && ed.selectedText()) {
    const t = ed.selectedText();
    return { text: t, apply: (lines) => ed.insertText(lines.join('\n')) };
  }
  const f = textTargets(app).find((x) => app.pub.story(x.story)?.paras.some((p) => paraText(p).trim()));
  if (!f) return null;
  const s = app.pub.story(f.story)!;
  return {
    text: s.paras.map(paraText).join('\n'), story: s.id,
    apply: (lines, label) => app.pub.transact(label, () => {
      const st = app.pub.story(s.id); if (!st) return;
      st.paras = lines.map((l, i) => { const old = st.paras[i] || st.paras[st.paras.length - 1] || { style: 'Body', runs: [] }; const fmt = old.runs.find((r) => !r.br && !r.field) || old.end || {}; const { text: _t, br: _b, field: _f, varName: _v, ...keep } = fmt as any; return { ...old, runs: l.trim() ? [{ ...keep, text: l.trim() }] : [] } as Paragraph; });
    }),
  };
}

async function textTask(app: App, key: keyof typeof TEXT_TASKS, arg?: string): Promise<void> {
  const inp = textInput(app);
  if (!inp) { toast('Select some text or a text frame first.'); return; }
  const task = TEXT_TASKS[key];
  if (key === 'tone' && !arg) {
    const r = await openDialog({ title: 'Change Tone', fields: [{ key: 't', label: 'Tone', type: 'combo', options: ['more formal', 'more casual', 'more persuasive', 'more confident', 'friendlier', 'simpler (plain language)', 'more technical', 'journalistic'], value: 'more formal' }] });
    if (!r) return; arg = r.t;
  }
  if (key === 'translate' && !arg) {
    const r = await openDialog({ title: 'Translate', fields: [{ key: 'l', label: 'Into', type: 'combo', options: ['English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Dutch', 'Polish', 'Russian', 'Ukrainian', 'Chinese (Simplified)', 'Japanese', 'Korean', 'Arabic', 'Hebrew', 'Hindi', 'Turkish', 'Greek', 'Swedish'], value: 'Spanish' }] });
    if (!r) return; arg = r.l;
  }
  const ans = await ask(app, task.prompt(inp.text, arg));
  if (ans == null) return;
  const out = await previewText(task.label, cleanText(ans).split(/\r?\n/).filter((l) => l.trim()).join('\n'));
  if (out == null) return;
  inp.apply(out.split('\n').filter((l) => l.trim()), task.label);
}

// ------------------------------------------------------------------------------------------
// Building pages from a draft

/** Lays a draft out: each page gets a headline, a deck, a multi-column body and optional sidebar, pull quote and caption frames. */
export function buildDraftPages(pub: Pub, draft: DraftPublication, after?: Page): Page[] {
  const pages: Page[] = [];
  const { w: pw, h: ph } = pub.size;
  draft.pages.forEach((dp, i) => {
    const page = addPageAfter(pub, i === 0 ? after : pages[pages.length - 1]);
    const g = pub.geometry(page);
    let [mt, mr, mb, ml] = g.margins;
    if (pub.pageSide(pub.pageIndex(page.id)) === 'left') [ml, mr] = [mr, ml];
    const x = ml, width = pw - ml - mr;
    let y = mt;
    const frame = (box: { x: number; y: number; w: number; h: number }, paras: Paragraph[], name: string): TextFrame => { const f = pub.newTextFrame(box, paras); f.name = name; f.insets = [0, 0, 0, 0]; page.items.push(f); return f; };
    const heading = i === 0 && draft.title ? draft.title : dp.heading;
    const hf = frame({ x, y, w: width, h: 56 }, [{ style: i === 0 ? 'Headline' : 'Heading 1', runs: [{ text: heading }] }], 'Headline');
    hf.autosize = 'height';
    y += 60;
    if (dp.deck || (i === 0 && draft.subtitle)) { const df = frame({ x, y, w: width, h: 30 }, [{ style: 'Deck', runs: [{ text: dp.deck || draft.subtitle || '' }] }], 'Deck'); df.autosize = 'height'; y += 36; }
    const sidebarW = dp.sidebar ? Math.min(180, width * 0.32) : 0;
    const bodyW = width - (sidebarW ? sidebarW + g.gutter : 0);
    const bodyH = ph - mb - y - (dp.caption ? 0 : 0);
    const body = frame({ x, y, w: bodyW, h: bodyH }, dp.body.map((t, k) => ({ style: k === 0 ? 'Body First' : 'Body', runs: [{ text: t }] })), 'Body');
    body.columns = Math.max(1, Math.min(g.columns, sidebarW ? Math.max(1, g.columns - 1) : g.columns));
    body.gutter = g.gutter;
    const s = pub.story(body.story); if (s) s.name = dp.heading;
    if (dp.sidebar) {
      const sb = frame({ x: x + bodyW + g.gutter, y, w: sidebarW, h: Math.min(bodyH, 40 + 18 * dp.sidebar.body.join(' ').length / 28) }, [{ style: 'Subhead', runs: [{ text: dp.sidebar.heading }] }, ...dp.sidebar.body.map((t) => ({ style: 'Body No Indent', runs: [{ text: t }] }))], 'Sidebar');
      sb.ostyle = 'Sidebar'; sb.insets = [9, 9, 9, 9]; sb.wrap = { mode: 'square', offset: 9 }; sb.autosize = 'height';
    }
    if (dp.pullQuote) {
      const pq = frame({ x: x + bodyW * 0.55, y: y + bodyH * 0.45, w: bodyW * 0.45, h: 90 }, [{ style: 'Pull Quote', ruleAbove: { width: 2, color: 'Primary' }, ruleBelow: { width: 2, color: 'Primary' }, runs: [{ text: `“${dp.pullQuote}”` }] }], 'Pull Quote');
      pq.wrap = { mode: 'square', offset: 9 }; pq.insets = [6, 0, 6, 0]; pq.autosize = 'height';
    }
    if (dp.caption) {
      const pic: PictureFrame = { id: newId('pic'), kind: 'picture', name: 'Picture', x, y: y + 4, w: bodyW * 0.42, h: bodyW * 0.3, fit: 'fill', wrap: { mode: 'square', offset: 9 }, line: { fill: { type: 'solid', color: 'Gray' }, width: 0.5, dash: 'dash' } };
      page.items.push(pic);
      const cf = frame({ x, y: pic.y + pic.h + 4, w: pic.w, h: 24 }, [{ style: 'Caption', runs: [{ text: dp.caption }] }], 'Caption');
      cf.wrap = { mode: 'square', offset: 6 }; cf.autosize = 'height';
    }
    pages.push(page);
  });
  return pages;
}

// ------------------------------------------------------------------------------------------

const ENSEMBLE_MODES: { value: EnsembleMode; label: string }[] = [
  { value: 'single', label: 'Single AI' },
  { value: 'master', label: 'Master Combines Answers' },
  { value: 'consensus', label: 'Quaker Consensus' },
];

async function setEnsembleMode(app: App, mode?: string): Promise<void> {
  const pick = ENSEMBLE_MODES.find((o) => o.value === mode);
  const { openAiSettings } = await import('../ui/aiWizard');
  if (!pick) { await openAiSettings(app, { section: 'ensemble' }); return; }
  if (pick.value !== 'single' && Object.keys(aiSettings().providers).length < 2) {
    toast('Set up at least two AI providers to use several AIs.', { action: 'Set Up AI', onAction: () => app.exec('ai.setup'), ms: 7000 });
    return;
  }
  saveAiSettings((s) => { s.ensemble.mode = pick.value; });
  if (pick.value !== 'single' && (aiSettings().ensemble.members?.length || 0) < 2) await openAiSettings(app, { section: 'ensemble', mode: pick.value });
  app.ui.refresh?.();
  toast(pick.value === 'single' ? 'AI: one AI answers (the active provider)' : `AI: ${pick.label}`);
}

const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));

/** Rule-based layout observations the AI command adds to (and shows on their own without a provider). */
export function layoutObservations(app: App): string[] {
  const pub = app.pub;
  const p = app.page;
  const out: string[] = [];
  if (!p) return out;
  const items = p.items.filter((e) => !e.hidden);
  const g = pub.geometry(p);
  const frames = items.filter((e): e is TextFrame => e.kind === 'text');
  const pics = items.filter((e): e is PictureFrame => e.kind === 'picture');
  if (!items.length) out.push('The page is empty: place a text file (Insert ▸ Place Text File) or start from a template.');
  for (const f of frames) {
    const lay = storyLayout(pub, f.story);
    if (lay?.r.overset && !f.next) out.push(`"${f.name || 'A text frame'}" has overset text: link it to another frame or use Autoflow.`);
    const cw = (f.w - (f.insets?.[0] || 0) - (f.insets?.[2] || 0) - ((f.columns || 1) - 1) * (f.gutter ?? 12)) / (f.columns || 1);
    const s = pub.story(f.story);
    const size = s ? (s.paras[0]?.runs[0]?.size || 11) : 11;
    const cpl = cw / (size * 0.5);
    if (cpl > 90) out.push(`Lines in "${f.name || 'a frame'}" run about ${Math.round(cpl)} characters: split it into ${Math.min(4, Math.ceil(cpl / 65))} columns or raise the type size.`);
    if (cpl < 25 && cpl > 0) out.push(`Lines in "${f.name || 'a frame'}" are only about ${Math.round(cpl)} characters: widen the column or reduce the size.`);
    if (s && s.paras.some((x) => x.align === 'just' || x.align === 'justAll') && !s.paras.some((x) => x.hyphenate)) out.push('Justified text without hyphenation leaves gaps: turn on Hyphenate (Text ▸ Typography).');
  }
  for (const pic of pics) { const dpi = pic.media ? effectiveDpi(app, pic) : null; if (dpi != null && dpi < 150) out.push(`"${pic.name || 'A picture'}" is at ${Math.round(dpi)} ppi: make it smaller or use a larger file.`); if (!pic.media) out.push(`"${pic.name || 'A picture frame'}" is empty.`); }
  const fonts = new Set<string>(); for (const st of pub.data.styles.para) if (st.run?.font) fonts.add(st.run.font);
  if (fonts.size > 3) out.push(`The styles use ${fonts.size} fonts; two families (one for headings, one for text) read better.`);
  const heads = frames.filter((f) => /head|title/i.test(f.name || '') || pub.story(f.story)?.paras[0]?.style?.startsWith('Head'));
  if (frames.length && !heads.length) out.push('No heading on this page: give the first paragraph a Heading or Headline style.');
  if (items.some((e) => e.x < g.margins[3] - 1 || e.x + e.w > pub.size.w - g.margins[1] + 1) && !items.some((e) => e.kind === 'picture' && (e.x <= 0 || e.x + e.w >= pub.size.w))) out.push('Objects cross the margins: align them to the margin guides (Arrange ▸ Align to Margins), or bleed pictures off the page deliberately.');
  return out;
}

def([
  {
    id: 'ai.setup', label: 'Set Up AI', icon: 'auto_awesome', tab: 'AI', group: 'Setup', popular: true, noRecord: true, edits: false,
    tip: 'Choose a free or paid AI: on this device, free cloud tiers, your own computer, or a paid key', keywords: 'api key openai anthropic gemini mistral groq openrouter ollama wizard',
    run: async (app) => { const { openAiSetup } = await import('../ui/aiWizard'); await openAiSetup(app); },
  },
  { id: 'ai.providers', label: 'Providers & Models', icon: 'tune', tab: 'AI', group: 'Setup', noRecord: true, edits: false, tip: 'Switch AI provider, choose models, test or remove keys', run: async (app) => { const { openAiProviders } = await import('../ui/aiWizard'); await openAiProviders(app); } },
  {
    id: 'ai.active', label: 'Active AI', icon: 'swap_horiz', tab: 'AI', group: 'Setup', kind: 'menu', noRecord: true, edits: false, tip: 'Switch between the AI providers you have set up',
    run: async (app, id?: string) => {
      if (!id) { const { openAiProviders } = await import('../ui/aiWizard'); await openAiProviders(app); return; }
      if (!aiSettings().providers[id]) return;
      saveAiSettings((s) => { s.active = id; });
      toast(`AI: ${providerById(id)?.name}`);
    },
    menu: () => { const s = aiSettings(); const items: MenuEntry[] = Object.keys(s.providers).map((id) => ({ id: 'ai.active', arg: id, label: `${providerById(id)?.name || id} · ${s.providers[id].model}`, checked: s.active === id })); return [...items, ...(items.length ? [{ separator: true }] : []), { id: 'ai.setup', label: 'Add a Provider…' }]; },
  },
  { id: 'ai.settings', label: 'AI Settings', icon: 'settings_suggest', tab: 'AI', group: 'Setup', noRecord: true, edits: false, tip: 'Turn AI on or off, language for generated text, style guide, usage', run: async (app) => { const { openAiSettings } = await import('../ui/aiWizard'); await openAiSettings(app); } },
  {
    id: 'ai.privacy', label: 'AI & Privacy', icon: 'shield', tab: 'AI', group: 'Setup', noRecord: true, edits: false, tip: 'Where your text goes when you use AI',
    run: async () => {
      const p = providerById(aiSettings().active || '');
      await openDialog({ title: 'AI & Privacy', ok: 'Close', cancel: false, fields: [{ key: 'i', type: 'info', html: [
        '<p><b>QuillPress has no server.</b> AI requests go directly from this device to the provider you choose, using your own key. Nothing is sent until you run an AI command.</p>',
        `<p><b>Active provider:</b> ${p ? esc(p.name) : 'none'}${p && (p.kind === 'local' || p.kind === 'builtin') ? ' — runs on this device; your publication does not leave it.' : p ? ' — the text a command needs (the selection, the story, or the publication\'s text for whole-publication commands) is sent to this service; its terms apply.' : ''}</p>`,
        activeEnsemble() ? `<p><b>Several AIs are on.</b> Each AI command sends the same text to every one of these services: ${esc(names(aiRecipients()))}.</p>` : '',
        '<p><b>Pictures</b> are sent only by Generate Alt Text and Write Caption, and only the selected picture.</p>',
        '<p><b>Keys</b> are stored on this device only. They are never placed in publications, drafts or exported settings.</p>',
        '<p><b>Changes are previewed</b> and applied as one step you can undo.</p>',
      ].join('') }] });
    },
  },
  { id: 'ai.stop', label: 'Stop AI', icon: 'stop_circle', tab: 'AI', group: 'Setup', noRecord: true, edits: false, isEnabled: () => !!controller, tip: 'Stop the AI request in progress', run: () => { controller?.abort(); controller = null; } },
  {
    id: 'ai.deleteModels', label: 'Delete Downloaded Models', icon: 'delete_sweep', tab: 'AI', group: 'Setup', noRecord: true, edits: false, tip: 'Free the storage used by the on-device AI model',
    run: async () => { const { clearLocalModels, localStorageEstimate } = await import('../ai/local'); if (!(await confirmDialog('Delete Downloaded Models', `Delete the on-device AI model files? (${await localStorageEstimate()}). They download again the next time you use the on-device model.`, 'Delete'))) return; const n = await clearLocalModels(); toast(`Deleted ${n} cached file(s).`); },
  },
  {
    id: 'ai.ensembleMode', label: 'Several AIs', icon: 'groups', tab: 'AI', group: 'Several AIs', kind: 'menu', edits: false,
    tip: 'Ask one AI, or several at once: one AI combines their answers (master), or they deliberate until they agree (Quaker consensus)',
    run: (app, mode?: string) => setEnsembleMode(app, mode),
    menu: () => { const e = aiSettings().ensemble; return [...ENSEMBLE_MODES.map((o) => ({ id: 'ai.ensembleMode', arg: o.value, label: o.label, checked: e.mode === o.value })), { separator: true }, { id: 'ai.ensembleMembers', label: 'Choose AIs…' }, { id: 'ai.showDeliberation', label: 'Show AI Discussion', checked: e.showDeliberation }]; },
    isActive: () => aiSettings().ensemble.mode !== 'single',
  },
  { id: 'ai.ensembleMembers', label: 'Choose AIs', icon: 'checklist', tab: 'AI', group: 'Several AIs', noRecord: true, edits: false, tip: 'Choose which AIs answer together, the master or clerk, and the rounds of discussion', run: async (app) => { const { openAiSettings } = await import('../ui/aiWizard'); await openAiSettings(app, { section: 'ensemble' }); } },
  { id: 'ai.showDeliberation', label: 'Show AI Discussion', icon: 'forum', tab: 'AI', group: 'Several AIs', kind: 'toggle', edits: false, tip: 'Show the outcome of the discussion when several AIs answer', run: (app, on?: boolean) => { saveAiSettings((s) => { s.ensemble.showDeliberation = typeof on === 'boolean' ? on : !s.ensemble.showDeliberation; }); app.ui.refresh?.(); }, isActive: () => aiSettings().ensemble.showDeliberation },

  // Create
  {
    id: 'ai.draftPublication', label: 'Draft Publication', icon: 'auto_awesome_motion', tab: 'AI', group: 'Create', edits: true, popular: true,
    tip: 'Describe the publication; the AI writes the articles, then QuillPress lays them out on pages with headlines, decks, columns, sidebars and pull quotes',
    run: async (app) => {
      const r = await openDialog({ title: 'Draft Publication', fields: [
        { key: 'brief', label: 'What is it about? (topic, purpose, key points)', type: 'textarea', rows: 4, value: '' },
        { key: 'kind', label: 'Kind', type: 'combo', options: ['newsletter', 'brochure', 'flyer', 'magazine feature', 'report', 'program', 'menu', 'catalog'], value: 'newsletter', half: true },
        { key: 'n', label: 'About how many pages', type: 'number', value: 4, min: 1, max: 24, half: true },
        { key: 'aud', label: 'Audience', type: 'text', value: '', half: true },
        { key: 'tone', label: 'Tone', type: 'combo', options: ['clear and professional', 'friendly', 'persuasive', 'journalistic', 'academic', 'playful'], value: 'clear and professional', half: true },
        { key: 'where', label: 'Put the pages', type: 'radio', options: [{ value: 'new', label: 'In a new publication' }, { value: 'here', label: 'After the current page' }], value: app.pub.pages.length > 1 || app.pub.pages[0]?.items.length ? 'new' : 'here' },
      ] });
      if (!r || !String(r.brief).trim()) return;
      const ans = await ask(app, draftPublicationPrompt(r.brief, +r.n || 4, r.kind, r.aud, r.tone), { maxTokens: 6000 });
      if (ans == null) return;
      const draft = parseDraft(ans);
      if (!draft?.pages.length) { toast('The AI answer had no pages in it.'); return; }
      const preview = draft.pages.map((p, i) => `${i + 1}. ${p.heading}${p.deck ? `\n   ${p.deck}` : ''}\n   ${p.body.join(' ').slice(0, 160)}…`).join('\n');
      if (!(await confirmDialog(`Draft: ${draft.title}`, `${draft.pages.length} page(s):\n\n${preview}`, r.where === 'new' ? 'Create Publication' : 'Insert Pages'))) return;
      if (r.where === 'new') {
        const pub = Pub.blank(app.pub.size, { facing: app.pub.data.facing, margins: app.pub.data.masters[0].margins, columns: Math.max(2, app.pub.data.masters[0].columns) });
        pub.data.unit = app.prefs.unit; pub.data.props.title = draft.title; pub.data.props.author = app.prefs.author;
        pub.data.pages = [];
        buildDraftPages(pub, draft);
        pub.clearHistory();
        app.createTab(pub, { title: draft.title });
        return;
      }
      const cur = app.page;
      const empty = cur && !cur.items.length && app.pub.pages.length === 1;
      let first: Page | undefined;
      app.pub.transact('Draft Publication', () => { const pages = buildDraftPages(app.pub, draft, cur); first = pages[0]; if (empty && cur) app.pub.data.pages = app.pub.data.pages.filter((p) => p !== cur); if (!app.pub.data.props.title) app.pub.data.props.title = draft.title; });
      if (first) app.goToPage(first.id);
    },
  },
  {
    id: 'ai.draftStory', label: 'Draft Story', icon: 'article', tab: 'AI', group: 'Create', edits: true,
    tip: 'Write an article about a topic into the selected frame (or a new one)',
    run: async (app) => {
      const r = await openDialog({ title: 'Draft Story', fields: [{ key: 'topic', label: 'Topic', type: 'textarea', rows: 3, value: '' }, { key: 'words', label: 'About how many words', type: 'number', min: 50, max: 3000, value: 300, half: true }, { key: 'tone', label: 'Tone', type: 'combo', options: ['clear and professional', 'friendly', 'journalistic', 'persuasive', 'academic'], value: 'clear and professional', half: true }] });
      if (!r || !String(r.topic).trim()) return;
      const ans = await ask(app, draftStoryPrompt(r.topic, +r.words || 300, r.tone), { maxTokens: 3000 });
      if (ans == null) return;
      const out = await previewText('Draft Story', cleanText(ans), 'Place');
      if (out == null) return;
      const lines = out.split(/\n+/).map((l) => l.trim()).filter(Boolean);
      const paras: Paragraph[] = lines.map((l, i) => ({ style: i === 0 ? 'Heading 1' : i === 1 ? 'Deck' : i === 2 ? 'Body First' : 'Body', runs: [{ text: l }] }));
      const f = textTargets(app)[0];
      if (f) { app.pub.transact('Draft Story', () => { const s = app.pub.story(f.story); if (s) s.paras = paras; }); return; }
      const nf = app.pub.newTextFrame(placeNew(app, 360, 400), paras);
      nf.name = lines[0]?.slice(0, 40);
      insertItem(app, nf, 'Draft Story');
      if (oversetFrames(app.pub).some((o) => o.frame.id === nf.id)) toast('The story does not fit the frame.', { action: 'Autoflow', onAction: () => app.exec('text.autoflow'), ms: 7000 });
    },
  },
  {
    id: 'ai.headlines', label: 'Suggest Headlines', icon: 'title', tab: 'AI', group: 'Create', edits: true,
    tip: 'Headline ideas for the selected story; the chosen one replaces its heading (or is added above)',
    run: async (app) => {
      const inp = textInput(app);
      if (!inp?.story) { toast('Select a text frame with the story first.'); return; }
      const ans = await ask(app, TEXT_TASKS.headlines.prompt(inp.text.slice(0, 6000)), { tier: 'fast', maxTokens: 300 });
      if (ans == null) return;
      const pick = await pickLine('Headlines', linesOf(ans).slice(0, 8), 'Use Headline');
      if (!pick) return;
      app.pub.transact('Headline', () => { const s = app.pub.story(inp.story!); if (!s) return; const hp = s.paras.find((p) => /^Head|Headline/.test(p.style || '')); if (hp) hp.runs = [{ ...(hp.runs[0] || {}), text: pick }]; else s.paras.unshift({ style: 'Heading 1', runs: [{ text: pick }] }); });
    },
  },
  {
    id: 'ai.decks', label: 'Suggest Deck', icon: 'subtitles', tab: 'AI', group: 'Create', edits: true,
    tip: 'A one-sentence summary to print under the headline',
    run: async (app) => {
      const inp = textInput(app);
      if (!inp?.story) { toast('Select a text frame with the story first.'); return; }
      const ans = await ask(app, TEXT_TASKS.decks.prompt(inp.text.slice(0, 6000)), { tier: 'fast', maxTokens: 300 });
      if (ans == null) return;
      const pick = await pickLine('Decks', linesOf(ans).slice(0, 6), 'Use Deck');
      if (!pick) return;
      app.pub.transact('Deck', () => { const s = app.pub.story(inp.story!); if (!s) return; const i = s.paras.findIndex((p) => p.style === 'Deck'); if (i >= 0) s.paras[i].runs = [{ text: pick }]; else { const hi = s.paras.findIndex((p) => /^Head|Headline/.test(p.style || '')); s.paras.splice(hi + 1, 0, { style: 'Deck', runs: [{ text: pick }] }); } });
    },
  },
  {
    id: 'ai.pullQuotes', label: 'Suggest Pull Quotes', icon: 'format_quote', tab: 'AI', group: 'Create', edits: true,
    tip: 'Striking sentences from the selected story, placed as a pull quote frame that the text wraps around',
    run: async (app) => {
      const inp = textInput(app);
      if (!inp?.story) { toast('Select a text frame with the story first.'); return; }
      const ans = await ask(app, TEXT_TASKS.pullQuotes.prompt(inp.text.slice(0, 8000)), { tier: 'fast', maxTokens: 400 });
      if (ans == null) return;
      const pick = await pickLine('Pull Quotes', linesOf(ans).slice(0, 6), 'Insert Pull Quote');
      if (!pick) return;
      const f = textTargets(app)[0]!;
      const pq = app.pub.newTextFrame({ x: f.x + f.w * 0.55, y: f.y + f.h * 0.4, w: f.w * 0.45, h: 90 }, [{ style: 'Pull Quote', ruleAbove: { width: 2, color: 'Primary' }, ruleBelow: { width: 2, color: 'Primary' }, runs: [{ text: `“${pick.replace(/^[“"]|[”"]$/g, '')}”` }] }]);
      pq.name = 'Pull Quote'; pq.wrap = { mode: 'square', offset: 9 }; pq.insets = [6, 0, 6, 0]; pq.autosize = 'height';
      insertItem(app, pq, 'Pull Quote');
    },
  },
  {
    id: 'ai.captions', label: 'Write Caption', icon: 'subtitles', tab: 'AI', group: 'Create', edits: true, isEnabled: (app) => app.selected.length === 1 && app.selected[0].kind === 'picture',
    tip: 'Captions for the selected picture (the picture is sent to models with vision; others use its name and the page text)',
    run: async (app) => {
      const e = app.selected[0] as PictureFrame;
      const ctx = `picture named "${e.name || e.src || ''}"${e.alt ? ` described as "${e.alt}"` : ''} on a page whose text begins: ${pubText(app, 1200).slice(0, 600)}`;
      const content: string | ContentPart[] = e.media ? [{ type: 'text', text: TEXT_TASKS.captions.prompt(ctx) }, { type: 'image', dataUrl: app.pub.mediaUrl(e.media) }] : TEXT_TASKS.captions.prompt(ctx);
      const ans = await ask(app, content, { tier: 'fast', maxTokens: 300 });
      if (ans == null) return;
      const pick = await pickLine('Captions', linesOf(ans).slice(0, 5), 'Insert Caption');
      if (!pick) return;
      const cf = app.pub.newTextFrame({ x: e.x, y: e.y + e.h + 4, w: e.w, h: 24 }, [{ style: 'Caption', runs: [{ text: pick }] }]);
      cf.name = 'Caption'; cf.autosize = 'height';
      insertItem(app, cf, 'Caption');
    },
  },
  // Write
  ...(['rewrite', 'shorten', 'expand', 'tone', 'proofread', 'translate'] as const).map((k) => ({
    id: `ai.${k}`, label: TEXT_TASKS[k].label, icon: ({ rewrite: 'edit_note', shorten: 'compress', expand: 'expand', tone: 'theater_comedy', proofread: 'spellcheck', translate: 'g_translate' } as Record<string, string>)[k],
    tab: 'AI', group: 'Write', edits: true,
    tip: `${TEXT_TASKS[k].label} the selected text or the selected frame's story`,
    run: (app: App, arg?: string) => textTask(app, k, arg),
  })),
  {
    id: 'ai.fitCopy', label: 'Fit Copy by Rewriting', icon: 'compress', tab: 'AI', group: 'Write', edits: true, origin: 'Copy fitting by editors',
    tip: 'Shorten the overset story in words (not type size) until it fits its frames',
    run: async (app) => {
      const f = textTargets(app)[0];
      if (!f) { toast('Select the overset text frame first.'); return; }
      const pub = app.pub;
      const over = oversetFrames(pub).find((o) => pub.chainOf(o.frame.story).some((x) => x.id === f.id));
      if (!over) { toast('The story already fits.'); return; }
      const s = pub.story(f.story)!;
      const text = s.paras.map(paraText).join('\n');
      const ans = await ask(app, TEXT_TASKS.fit.prompt(text, String(Math.round(over.chars * 1.15 + 40))), { maxTokens: 4000 });
      if (ans == null) return;
      const out = await previewText('Fit Copy', cleanText(ans));
      if (out == null) return;
      pub.transact('Fit Copy', () => { const lines = out.split(/\n/).filter((l) => l.trim()); s.paras = lines.map((l, i) => { const old = s.paras[i] || s.paras[s.paras.length - 1]; const fmt = old?.runs.find((r) => !r.br && !r.field) || {}; const { text: _t, ...keep } = fmt as any; return { ...(old || { style: 'Body' }), runs: [{ ...keep, text: l.trim() }] } as Paragraph; }); });
      const still = oversetFrames(pub).find((o) => o.frame.story === s.id);
      toast(still ? `Still ${still.chars} characters overset; run Fit Copy again or use Text ▸ Fit Copy to scale the type.` : 'The story fits now.');
    },
  },
  // Design
  {
    id: 'ai.layoutSuggestions', label: 'Layout Suggestions', icon: 'tips_and_updates', tab: 'AI', group: 'Design', edits: false,
    tip: 'Observations about this page (measure, overset, resolution, fonts) plus the AI\'s suggestions',
    run: async (app) => {
      const obs = layoutObservations(app);
      const p = app.page;
      const desc = p ? `Page ${app.pub.pageIndex(p.id) + 1} of ${app.pub.pages.length}, ${Math.round(app.pub.size.w / 72 * 100) / 100} × ${Math.round(app.pub.size.h / 72 * 100) / 100} in, ${app.pub.geometry(p).columns} column(s). Objects: ${p.items.map((e) => `${e.kind}${e.name ? ` "${e.name}"` : ''} at (${Math.round(e.x)}, ${Math.round(e.y)}) ${Math.round(e.w)}×${Math.round(e.h)} pt${e.kind === 'text' ? `: ${paraText(app.pub.story(e.story)?.paras[0] || { runs: [] } as any).slice(0, 60)}` : ''}`).join('; ')}. Observations so far: ${obs.join(' ') || 'none'}.` : '';
      const ans = aiSettings().enabled && aiSettings().active ? await ask(app, TEXT_TASKS.layout.prompt(desc), { maxTokens: 800 }) : null;
      await openDialog({ title: 'Layout Suggestions', wide: true, ok: 'Close', cancel: false, fields: [{ key: 'i', type: 'info', html: `${obs.length ? `<h3>Checks</h3><ul>${obs.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : '<p>The checks found nothing to flag on this page.</p>'}${ans ? `<h3>AI suggestions</h3><div style="white-space:pre-wrap">${esc(cleanText(ans))}</div>` : '<p class="ql-help">Set up an AI provider (AI ▸ Set Up AI) for design suggestions beyond these checks.</p>'}` }] });
    },
  },
  {
    id: 'ai.altText', label: 'Generate Alt Text', icon: 'image_search', tab: 'AI', group: 'Design', edits: true, isEnabled: (app) => app.selected.length === 1 && ['picture', 'shape', 'group'].includes(app.selected[0].kind),
    tip: 'Describe the selected picture (the picture itself is sent; models without vision use its name and the page text)',
    run: async (app) => {
      const e = app.selected[0];
      const ctx = `object name "${e.name || ''}"; nearby text: ${pubText(app, 800).slice(0, 400)}`;
      let content: string | ContentPart[] = TEXT_TASKS.altText.prompt(ctx);
      if (e.kind === 'picture' && e.media) content = [{ type: 'text', text: TEXT_TASKS.altText.prompt(ctx) }, { type: 'image', dataUrl: app.pub.mediaUrl(e.media) }];
      const ans = await ask(app, content, { tier: 'fast', maxTokens: 200 });
      if (ans == null) return;
      const out = await previewText('Alt Text', cleanText(ans).replace(/^"|"$/g, ''));
      if (out == null) return;
      edit(app, 'Alt Text', (o) => { const x = app.pub.findItem(o, e.id); if (x) x.alt = out.trim(); });
    },
  },
  {
    id: 'ai.styleNames', label: 'Suggest Styles', icon: 'style', tab: 'AI', group: 'Design', edits: true,
    tip: 'Let the AI decide which paragraphs of the selected story are headlines, decks, bylines, subheads, body, lists and captions, then apply those styles',
    run: async (app) => {
      const f = textTargets(app)[0];
      if (!f) { toast('Select a text frame first.'); return; }
      const s = app.pub.story(f.story)!;
      const paras = s.paras.filter((p) => paraText(p).trim());
      if (!paras.length) { toast('The story is empty.'); return; }
      const ans = await ask(app, TEXT_TASKS.styles.prompt(paras.map((p, i) => `${i + 1}. ${paraText(p).slice(0, 200)}`).join('\n')), { tier: 'fast', maxTokens: 600 });
      if (ans == null) return;
      const roles = parseJsonLoose<string[]>(ans);
      if (!Array.isArray(roles)) { toast('The AI answer was not a list of roles.'); return; }
      const known = new Set(app.pub.data.styles.para.map((x) => x.name));
      const preview = paras.map((p, i) => `[${roles[i] || 'Body'}] ${paraText(p).slice(0, 60)}`).join('\n');
      if (!(await confirmDialog('Suggested Styles', preview, 'Apply'))) return;
      app.pub.transact('Suggest Styles', () => { paras.forEach((p, i) => { const r = String(roles[i] || 'Body'); if (known.has(r)) p.style = r; }); });
    },
  },
  {
    id: 'ai.summarize', label: 'Summary Box', icon: 'summarize', tab: 'AI', group: 'Design', edits: true, isEnabled: (app) => app.pub.data.stories.length > 0,
    tip: 'A sidebar summarizing the publication\'s text ("In brief")',
    run: async (app) => {
      const ans = await ask(app, TEXT_TASKS.summarize.prompt(pubText(app)));
      if (ans == null) return;
      const out = await previewText('Summary Box', linesOf(ans).join('\n'), 'Insert Box');
      if (out == null) return;
      const f = app.pub.newTextFrame(placeNew(app, 200, 160), [{ style: 'Subhead', runs: [{ text: 'In brief' }] }, ...out.split('\n').filter((l) => l.trim()).map((l) => ({ style: 'Bullet List', runs: [{ text: l.trim() }] }))]);
      f.name = 'Summary'; f.ostyle = 'Sidebar'; f.insets = [9, 9, 9, 9]; f.wrap = { mode: 'square', offset: 9 }; f.autosize = 'height';
      insertItem(app, f, 'Summary Box');
    },
  },
  // More
  {
    id: 'ai.assistant', label: 'AI Assistant', icon: 'chat', tab: 'AI', group: 'More', edits: false, noRecord: true,
    tip: 'Ask questions about this publication (its text is sent with your question)',
    run: async (app) => {
      const log = h('div', { class: 'ql-ai-log', style: 'max-height:45vh;overflow:auto;white-space:pre-wrap;min-width:min(80vw,640px)' });
      const history: ChatMessage[] = [];
      const ctx = pubText(app, 16000);
      for (;;) {
        const r = await openDialog({ title: 'AI Assistant', wide: true, content: log, ok: 'Ask', cancel: 'Close', fields: [{ key: 'q', label: 'Your question', type: 'textarea', rows: 3, value: '' }] });
        if (!r || !String(r.q).trim()) return;
        const q = String(r.q).trim();
        const prompt = history.length ? q : `Publication text:\n"""\n${ctx}\n"""\n\nQuestion: ${q}`;
        const ans = await ask(app, history.length ? [{ type: 'text', text: `${history.map((m) => `${m.role === 'user' ? 'Q' : 'A'}: ${typeof m.content === 'string' ? m.content : ''}`).join('\n')}\nQ: ${prompt}` }] : prompt);
        if (ans == null) return;
        history.push({ role: 'user', content: prompt }, { role: 'assistant', content: ans });
        log.append(h('p', null, h('b', null, 'You: '), q), h('p', null, h('b', null, 'AI: '), cleanText(ans)));
      }
    },
  },
  {
    id: 'ai.prompts', label: 'Prompt Library', icon: 'library_books', tab: 'AI', group: 'More', kind: 'menu', edits: true,
    tip: 'Run one of your saved prompts on the selected text',
    run: async (app, id?: string) => {
      const s = aiSettings();
      if (id === '__new') {
        const r = await openDialog({ title: 'New Prompt', fields: [{ key: 'name', label: 'Name', type: 'text', value: '' }, { key: 'prompt', label: 'Prompt (the selected text is added after it)', type: 'textarea', rows: 5, value: '' }] });
        if (!r?.name || !r.prompt) return;
        saveAiSettings((x) => { x.prompts.push({ id: newId('pr'), name: r.name, prompt: r.prompt, input: 'selection', output: 'replace' } as any); });
        return;
      }
      const p = s.prompts.find((x) => x.id === id);
      if (!p) { const n = await promptDialog('Prompt Library', 'Prompt to run on the selection', ''); if (!n) return; const inp = textInput(app); const ans = await ask(app, `${n}\n"""\n${inp?.text || pubText(app)}\n"""`); if (ans == null) return; const out = await previewText('Prompt', cleanText(ans), inp ? 'Replace Selection' : 'Close'); if (out != null && inp) inp.apply(out.split('\n'), 'Prompt'); return; }
      const inp = textInput(app);
      if (!inp && p.input === 'selection') { toast('Select some text or a text frame first.'); return; }
      const ans = await ask(app, `${p.prompt}\n"""\n${p.input === 'document' ? pubText(app) : inp?.text || ''}\n"""`);
      if (ans == null) return;
      const out = await previewText(p.name, cleanText(ans), inp ? 'Replace Selection' : 'Close');
      if (out != null && inp) inp.apply(out.split('\n'), p.name);
    },
    menu: () => [...aiSettings().prompts.map((p) => ({ id: 'ai.prompts', arg: p.id, label: p.name })), ...(aiSettings().prompts.length ? [{ separator: true }] : []), { id: 'ai.prompts', arg: '__new', label: 'New Prompt…' }],
  },
]);

