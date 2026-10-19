/** Recovery report dialog and the manual recovery guide (adapted from socrtwo/wordrecovery-SF). */
import { h, icon, pickFile } from './dom';
import { openDialog, toast } from './dialog';
import type { RecoveryReport, MethodStatus } from '../io/recover';
import type { Pub } from '../model/pub';
import { MIME } from '../io/recover/fileid';
import { pageTitle } from '../render/page';
import { saveAs, openExternal, platformName } from '../platform/native';

const STATUS: Record<MethodStatus, [string, string]> = {
  success: ['check_circle', 'Succeeded'],
  partial: ['adjust', 'Partial'],
  failed: ['cancel', 'Failed'],
  skipped: ['remove_circle_outline', 'Skipped'],
};

export interface ReportActions {
  /** Open the recovered publication in a new tab. */
  openPub?: (pub: Pub, name: string, report: RecoveryReport) => void;
  /** The recovered publication is already open: switch to it. */
  open?: () => void;
}

export function recoverySummary(r: RecoveryReport): string {
  return r.summary || (r.pub ? 'The publication was recovered.' : 'Nothing could be recovered from this file.');
}

const plural = (n: number, w: string) => `${n.toLocaleString('en-US')} ${n === 1 ? w : w + 's'}`;

function pageRows(r: RecoveryReport): HTMLElement | null {
  if (!r.pub) return null;
  const pub = r.pub;
  return h('table', { class: 'ql-recovery-methods' },
    h('tbody', null, pub.pages.slice(0, 200).map((pg, i) => {
      const title = pageTitle(pub, pg) || '(no text)';
      const recovered = /^Recovered (text|media|pictures)/.test(title);
      return h('tr', { class: recovered ? 'ql-st-partial' : 'ql-st-success' },
        h('td', { title: recovered ? 'Rebuilt from fragments' : 'Recovered' }, icon(recovered ? 'warning' : 'crop_portrait')),
        h('td', null, h('b', null, `${i + 1}. ${title}`), h('div', { class: 'ql-help' }, plural(pg.items.length, 'object'))));
    })));
}

export async function showRecoveryReport(r: RecoveryReport, actions: ReportActions = {}): Promise<void> {
  const base = r.fileName.replace(/\.[^.]+$/, '');
  const body = h('div', { class: 'ql-recovery' },
    h('p', { class: 'ql-recovery-summary' }, h('b', null, recoverySummary(r))),
    h('p', { class: 'ql-help' }, `Identified as: ${r.identification.description} (${r.identification.confidence} confidence).`),
    r.unverified ? h('p', { class: 'ql-help', style: 'color:#c62828' }, icon('warning'), ' Some of the recovered content was decoded from a damaged area of the file. Check it against another copy before relying on it.') : null,
    r.textOnly ? h('p', { class: 'ql-help', style: 'color:#b26a00' }, 'Only loose text was recovered: it is placed in plain text frames, and layout and formatting are lost.') : null,
    r.notes.length ? h('ul', { class: 'ql-recovery-notes' }, r.notes.map((n) => h('li', null, n))) : null,
    h('h3', null, 'Recovery methods'),
    h('table', { class: 'ql-recovery-methods' },
      h('tbody', null, r.methods.map((m) => {
        const [ic, label] = STATUS[m.status];
        const best = r.bestMethod === m.id;
        return h('tr', { class: `ql-st-${m.status}${best ? ' ql-best' : ''}` },
          h('td', { title: label }, icon(ic)),
          h('td', null, h('b', null, m.name), best ? h('span', { class: 'ql-chip' }, 'used') : null,
            h('div', { class: 'ql-help' }, m.detail || label), h('div', { class: 'ql-help ql-dim' }, m.desc)));
      }))),
    r.pub ? h('div', null, h('h3', null, `Recovered pages (${r.pub.pages.length})`), pageRows(r)) : null,
    r.repaired && (r.repaired.repairedParts.length || r.repaired.salvagedParts.length || r.repaired.lostParts.length)
      ? h('div', null,
        h('h3', null, 'Package parts'),
        r.repaired.salvagedParts.length ? h('p', { class: 'ql-help' }, `Salvaged from raw bytes: ${r.repaired.salvagedParts.join(', ')}`) : null,
        r.repaired.repairedParts.length ? h('p', { class: 'ql-help' }, `Repaired: ${r.repaired.repairedParts.join('; ')}`) : null,
        r.repaired.lostParts.length ? h('p', { class: 'ql-help' }, `Could not recover: ${r.repaired.lostParts.join(', ')}`) : null)
      : null,
    r.foreign.length ? h('div', null,
      h('h3', null, 'Other data found inside the file'),
      r.foreign.map((seg) => h('div', { class: 'ql-recovery-seg' },
        h('span', null, `${seg.description}: ${fmtSize(seg.length)} at byte ${seg.offset.toLocaleString('en-US')}`),
        h('button', { class: 'ql-btn', onclick: () => saveAs(new Blob([seg.bytes.slice()], { type: MIME[seg.ext] || 'application/octet-stream' }), seg.suggestedName || `${base}.part.${seg.ext}`) }, 'Save piece…'),
        seg.recommended?.[0] ? h('button', { class: 'ql-link', onclick: () => openExternal(seg.recommended![0].url) }, `Repair with ${seg.recommended[0].name}`) : null)))
      : null,
    !r.pub && r.recommended.length ? h('div', null,
      h('h3', null, 'Other tools'),
      h('p', { class: 'ql-help' }, 'These free S2 recovery tools specialize in this kind of file:'),
      h('ul', { class: 'ql-recovery-notes' }, r.recommended.slice(0, 4).map((p) => h('li', null, h('button', { class: 'ql-link', onclick: () => openExternal(p.url) }, p.name)))))
      : null,
  );
  const buttons: { label: string; onClick: (v: Record<string, any>, ctl: any) => void; primary?: boolean }[] = [];
  if (r.pub && (actions.openPub || actions.open)) {
    buttons.push({
      label: 'Open recovered publication', primary: true,
      onClick: (_v, ctl) => { ctl.close(null); if (actions.openPub) actions.openPub(r.pub!, `${base} (Recovered)`, r); else actions.open!(); },
    });
  }
  if (r.pub && !actions.openPub && !actions.open) {
    buttons.push({
      label: 'Save recovered publication…',
      onClick: async () => {
        try {
          const { exportPublication } = await import('../io');
          const out = await exportPublication(r.pub!, 'qpp');
          saveAs(new Blob([out.data.slice()], { type: out.mime }), `${base} (recovered).qpp`);
        } catch (e: any) { toast(`Could not save: ${e?.message || e}`); }
      },
    });
  }
  if (r.repaired) {
    const kind = r.repaired.kind;
    buttons.push({
      label: `Save repaired package (.${kind})…`,
      onClick: () => saveAs(r.repaired!.blob, r.repaired!.name),
    });
  }
  buttons.push({
    label: 'Copy report',
    onClick: async () => {
      try {
        const { reportText } = await import('../io/recover');
        await navigator.clipboard.writeText(reportText(r));
        toast('Recovery report copied');
      } catch { toast('Clipboard is not available'); }
    },
  });
  buttons.push({ label: 'Manual recovery options', onClick: () => { void showManualRecovery(actions); } });
  await openDialog({ title: `Recovery Report: ${r.fileName}`, content: body, wide: true, ok: 'Close', cancel: false, buttons });
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

const link = (url: string, text: string) => `<a href="${url}" data-external="1">${text}</a>`;

/** Per-platform manual recovery guide for publications, adapted from the Word Recovery "Manual recovery" tab. */
const MANUAL: Record<string, [string, string]> = {
  windows: ['Windows', `
    <h3>1. Recovered and unsaved files</h3>
    <p>Publishing programs keep automatic recovery copies. Paste into the Explorer address bar:</p>
    <ul><li><code>%AppData%\\Microsoft\\Publisher\\</code> (Publisher)</li><li><code>%AppData%\\Scribus\\</code> and the document's folder: <code>*.sla.autosave</code>, <code>*.sla.bak</code> (Scribus)</li><li><code>%LocalAppData%\\Adobe\\InDesign\\…\\InDesign Recovery\\</code> (InDesign)</li></ul>
    <h3>2. Temporary files</h3>
    <p><code>%Temp%</code> and the publication's folder: copy a likely temp file, rename it to the original extension and open it with <b>Open and Repair</b>.</p>
    <h3>3. Previous Versions / Shadow Copies</h3>
    <p>Right-click the file or folder &gt; Properties &gt; <b>Previous Versions</b> (needs System Protection or File History). OneDrive and SharePoint keep a version history.</p>
    <h3>4. Deleted-file recovery</h3>
    <p>${link('https://www.ccleaner.com/recuva', 'Recuva')} · ${link('https://www.cgsecurity.org/wiki/PhotoRec', 'PhotoRec')} · ${link('https://www.voidtools.com/', 'Everything')}</p>`],
  macos: ['macOS', `
    <h3>1. Autosave and recovery folders</h3>
    <ul><li><code>~/Library/Application Support/Scribus/</code> and <code>*.sla.autosave</code> next to the document</li><li><code>~/Library/Caches/Adobe InDesign/…/InDesign Recovery/</code></li></ul>
    <p>Finder &gt; Go &gt; <b>Go to Folder…</b>; hold Option on the Go menu to show Library.</p>
    <h3>2. Time Machine and iCloud</h3><p>Open the containing folder and enter Time Machine; iCloud Drive keeps recently deleted files for 30 days.</p>
    <h3>3. Other programs</h3><p>${link('https://www.scribus.net/', 'Scribus')} opens .sla files that other versions refuse; its File &gt; Open shows autosave copies.</p>`],
  linux: ['Linux', `
    <h3>1. Scribus autosave and backups</h3><p>Scribus writes <code>document.sla.autosave</code> and numbered <code>.bak</code> files next to the document (File &gt; Preferences &gt; Document &gt; Autosave).</p>
    <h3>2. Repair the ZIP container of a .qpp</h3><pre><code>cp damaged.qpp broken.zip
zip -FF broken.zip --out fixed.zip
mv fixed.zip recovered.qpp</code></pre>
    <h3>3. Extract text and pictures directly</h3><pre><code>unzip -p damaged.qpp publication.json | python3 -m json.tool | grep '"text"'
unzip damaged.qpp 'media/*' -d pictures</code></pre>
    <h3>4. Strings on any file</h3><pre><code>strings -n 4 damaged.sla | less</code></pre>
    <h3>5. Deleted-file recovery</h3><p>${link('https://www.cgsecurity.org/wiki/PhotoRec', 'PhotoRec')} · ${link('https://github.com/sleuthkit/sleuthkit', 'The Sleuth Kit')}</p>`],
  android: ['Android', `
    <h3>1. Version history in the app that created the file</h3>
    <p>Google Drive and OneDrive keep versions of every file: open the file's menu &gt; <b>Version history</b>.</p>
    <h3>2. Trash and recently deleted</h3>
    <p>Google Drive &gt; <b>Trash</b>, OneDrive &gt; <b>Recycle bin</b>, and the Files app's trash keep deleted files for about 30 days.</p>
    <h3>3. QuillPress's own copies</h3>
    <p>Open &gt; Recent keeps a cached copy of each file you opened here, and unsaved drafts are kept automatically.</p>`],
  ios: ['iOS / iPadOS', `
    <h3>1. Files &gt; Recently Deleted</h3><p>Files keeps deleted items for about 30 days.</p>
    <h3>2. iCloud Drive versions</h3><p>iCloud.com &gt; Drive &gt; Recently Deleted; some apps offer Browse All Versions.</p>
    <h3>3. QuillPress's own copies</h3><p>Open &gt; Recent keeps a cached copy of each file you opened here, and unsaved drafts are kept automatically.</p>`],
  tools: ['More S2 recovery tools', `
    <p>Free tools by the author of QuillPress's recovery engine, each specialized for one kind of damage:</p>
    <ul>
      <li>${link('https://socrtwo.github.io/Immortal-Zip/', 'Immortal Zip')} · ${link('https://socrtwo.github.io/xmltrncatorfixr-SF/app/', 'XML Truncator-Fixer')} · ${link('https://socrtwo.github.io/Universal-File-Repair-Tool/', 'Universal File Repair Tool')}</li>
      <li>${link('https://socrtwo.github.io/wordrecovery-SF/', 'Word Recovery')} · ${link('https://socrtwo.github.io/oorecovery-SF/', 'OO Recovery (OpenDocument)')} · ${link('https://socrtwo.github.io/file-fixer-bot/', 'File Fixer Bot')}</li>
    </ul>`],
};

/** Pick a file, run every recovery method on it (Open and Repair), and show the report. */
export async function recoverPickedFile(actions: ReportActions = {}): Promise<RecoveryReport | null> {
  const [file] = await pickFile('*/*');
  if (!file) return null;
  const { recoverPublication } = await import('../io/recover');
  toast(`Recovering ${file.name}…`, { ms: 2500 });
  const report = await recoverPublication(new Uint8Array(await file.arrayBuffer()), file.name, { forceRepair: true });
  await showRecoveryReport(report, actions);
  return report;
}

export async function showManualRecovery(actions: ReportActions = {}): Promise<void> {
  const plat = platformName();
  const guess = plat === 'android' ? 'android' : plat === 'ios' ? 'ios' : /Mac/.test(navigator.platform) ? 'macos' : /Linux/.test(navigator.platform) ? 'linux' : 'windows';
  const content = h('div', { class: 'ql-manual' });
  const pane = h('div', { class: 'ql-manual-body' });
  const tabs = h('div', { class: 'ql-seg' }, Object.entries(MANUAL).map(([k, [label]]) => h('button', { class: 'ql-seg-btn', 'data-k': k, onclick: () => show(k) }, label)));
  const show = (k: string) => {
    pane.innerHTML = MANUAL[k][1];
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('ql-on', b.getAttribute('data-k') === k));
  };
  pane.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a[data-external]') as HTMLAnchorElement | null;
    if (a) { e.preventDefault(); openExternal(a.href); }
  });
  const intro = h('p', { class: 'ql-help' }, 'QuillPress can try every recovery method on a damaged publication (.qpp, .qppe, .sla or .json) or on any file that may hold text or pictures: pick it with "Recover a file…". The steps below find other copies of the file.');
  content.append(intro, tabs, pane);
  show(guess);
  await openDialog({
    title: 'Manual Recovery Options', content, wide: true, ok: 'Close', cancel: false,
    buttons: [{ label: 'Recover a file…', primary: true, onClick: (_v, ctl) => { ctl.close(null); void recoverPickedFile(actions).catch((e) => toast(`Recovery failed: ${e?.message || e}`)); } }],
  });
}
