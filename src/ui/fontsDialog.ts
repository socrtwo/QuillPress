/**
 * The Fonts dialog (Text ▸ Typography ▸ Fonts…): the fonts people added from their own files, with
 * Add, Remove and Install (for fonts that came inside a publication package), the "Package fonts with
 * this publication" option, and the fonts the open publication uses with their availability.
 */
import { h, esc, pickFile } from './dom';
import { openDialog, toast, confirmDialog } from './dialog';
import type { App } from '../app';
import { FONT_LIST, userFonts, userFont, addUserFont, removeUserFont, installUserFont, isUserFamily, onUserFontsChange, setPackageFonts, type UserFont } from '../fonts';
import { fontsUsed } from '../model/styles';

export const FONT_ACCEPT = '.ttf,.otf,.ttc,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2';

/** How a used family is served: bundled, a metric alias, the user's own, a packaged copy, or missing. */
export function fontAvailability(family: string): 'bundled' | 'user' | 'packaged' | 'missing' {
  const faces = userFonts().filter((f) => f.family.toLowerCase() === family.trim().toLowerCase());
  if (faces.length) return faces.every((f) => f.packaged) ? 'packaged' : 'user';
  if (FONT_LIST.some((f) => f.toLowerCase() === family.trim().toLowerCase())) return 'bundled';
  return 'missing';
}

const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** One-line description of a user font for lists and toasts. */
export function describeUserFont(f: UserFont): string {
  const bits = [f.format.toUpperCase(), kb(f.size)];
  if (f.cff) bits.push('CFF outlines');
  if (!f.embeddable) bits.push(f.format === 'woff2' ? 'screen only (not embedded in PDF)' : 'license forbids embedding');
  if (f.packaged) bits.push('from a package (this session only)');
  return `${f.family} ${f.subfamily} — ${bits.join(', ')}`;
}

/** Adds fonts picked from files; returns the fonts added. Errors become toasts, one per bad file. */
export async function addFontFiles(files: File[]): Promise<UserFont[]> {
  const out: UserFont[] = [];
  for (const file of files) {
    try {
      const f = await addUserFont(new Uint8Array(await file.arrayBuffer()), file.name);
      out.push(f);
    } catch (e) {
      toast(`${file.name}: ${(e as Error)?.message || e}`);
    }
  }
  if (out.length) {
    const bad = out.filter((f) => !f.embeddable);
    toast(out.length === 1 ? `Added ${out[0].family} ${out[0].subfamily}` : `Added ${out.length} fonts`, { ms: 3500 });
    if (bad.length) toast(bad.some((f) => f.format === 'woff2') ? 'WOFF2 fonts show on screen but cannot be embedded in PDF; add a TTF, OTF or WOFF file for printing.' : 'A font forbids embedding (OS/2 license bits): PDF export substitutes a standard font for it.', { ms: 6000 });
  }
  return out;
}

/** Text ▸ Typography ▸ Fonts… */
export async function openFontsDialog(app: App): Promise<void> {
  const list = h('div', { class: 'ql-fonts-list', style: 'max-height:240px;overflow:auto;border:1px solid var(--border, #ccc);border-radius:4px' });
  const used = h('div', { class: 'ql-fonts-used', style: 'max-height:140px;overflow:auto' });
  const empty = h('p', { class: 'ql-help', style: 'margin:8px' }, 'No fonts added yet. Add TrueType (.ttf), OpenType (.otf), collections (.ttc, first face), WOFF or WOFF2 files; they stay on this device and work everywhere the bundled fonts do.');
  const content = h('div', null);
  let selected: string | null = null;

  const renderList = () => {
    list.replaceChildren();
    const fonts = userFonts();
    if (!fonts.length) { list.appendChild(empty); return; }
    const table = h('table', { class: 'ql-table ql-fonts-table', style: 'width:100%;border-collapse:collapse' });
    table.appendChild(h('thead', null, h('tr', null, ...['Family', 'Style', 'Weight', 'Format', 'Size', 'PDF'].map((t) => h('th', { style: 'text-align:left;padding:2px 6px' }, t)))));
    const body = h('tbody', null);
    for (const f of fonts) {
      const pdf = f.embeddable ? (f.cff ? 'embedded (CFF)' : 'embedded') : f.format === 'woff2' ? 'not embedded' : 'license forbids';
      const tr = h('tr', { 'data-id': f.id, role: 'option', tabindex: '0', style: `cursor:pointer;${selected === f.id ? 'background:var(--accent-soft, #e9e1f5)' : ''}` },
        h('td', { style: `padding:2px 6px;font-family:"${esc(f.family)}";font-weight:${f.weight};font-style:${f.style}` }, f.family + (f.packaged ? ' (package)' : '')),
        h('td', { style: 'padding:2px 6px' }, f.subfamily), h('td', { style: 'padding:2px 6px' }, String(f.weight)), h('td', { style: 'padding:2px 6px' }, f.format.toUpperCase()),
        h('td', { style: 'padding:2px 6px' }, kb(f.size)), h('td', { style: 'padding:2px 6px' }, pdf));
      const pick = () => { selected = f.id; renderList(); };
      tr.addEventListener('click', pick);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      body.appendChild(tr);
    }
    table.appendChild(body);
    list.appendChild(table);
  };

  const renderUsed = () => {
    used.replaceChildren();
    const names = fontsUsed(app.pub.data);
    if (!names.length) { used.appendChild(h('p', { class: 'ql-help' }, 'Only the default fonts are used.')); return; }
    const ul = h('ul', { style: 'margin:4px 0;padding-left:18px' });
    for (const n of names) {
      const a = fontAvailability(n);
      const note = a === 'bundled' ? 'bundled' : a === 'user' ? 'your font' : a === 'packaged' ? 'packaged with this publication (not installed)' : 'missing — shows only where the device has it; PDF export substitutes a standard font';
      ul.appendChild(h('li', { style: `font-family:"${esc(n)}"` }, `${n} `, h('span', { class: 'ql-help' }, `(${note})`)));
    }
    used.appendChild(ul);
  };

  renderList(); renderUsed();
  const off = onUserFontsChange(() => { renderList(); renderUsed(); });
  content.append(
    h('p', { class: 'ql-help', style: 'margin-top:0' }, 'Fonts you add are yours to license: a font is embedded in PDF only when its license bits allow it. WOFF2 files show on screen but are not embedded.'),
    list,
    h('h4', { style: 'margin:12px 0 4px' }, 'Fonts used in this publication'),
    used,
  );

  try {
    await openDialog({
      title: 'Fonts', wide: true, ok: 'Close', cancel: false, content,
      fields: [{ key: 'pkg', type: 'checkbox', label: 'Package fonts with this publication (.qpp carries the fonts it uses)', value: app.prefs.packageFonts !== false }],
      onChange: (v) => { app.prefs.packageFonts = !!v.pkg; setPackageFonts(!!v.pkg); app.savePrefs(); },
      buttons: [
        { label: 'Add Fonts…', primary: true, onClick: async () => { const files = await pickFile(FONT_ACCEPT, true); if (files.length) { const added = await addFontFiles(files); if (added.length) selected = added[added.length - 1].id; renderList(); } } },
        { label: 'Remove', onClick: async () => {
          const f = selected ? userFont(selected) : undefined;
          if (!f) { toast('Select a font to remove.'); return; }
          if (!(await confirmDialog('Remove Font', `Remove ${f.family} ${f.subfamily} from this device?`, 'Remove'))) return;
          await removeUserFont(f.id); selected = null; renderList(); renderUsed();
        } },
        { label: 'Install Packaged', onClick: async () => {
          const pk = userFonts().filter((f) => f.packaged);
          if (!pk.length) { toast('No packaged fonts to install.'); return; }
          for (const f of pk) await installUserFont(f.id);
          toast(`Installed ${pk.length} font${pk.length === 1 ? '' : 's'} on this device`);
        } },
        { label: 'Replace Fonts…', onClick: (_v, ctl) => { ctl.close(); app.exec('edit.replaceFonts'); } },
      ],
    });
  } finally { off(); }
}

/** The "Fonts used" report (fonts.usedReport): families with how they are served. */
export async function openFontsUsedReport(app: App): Promise<void> {
  const names = fontsUsed(app.pub.data);
  const rows = names.map((n) => {
    const a = fontAvailability(n);
    const faces = userFonts().filter((f) => f.family.toLowerCase() === n.toLowerCase());
    const how = a === 'bundled' ? 'bundled with QuillPress; embedded in PDF' : a === 'missing' ? 'not available: shows only where the device has it; PDF export substitutes a standard font'
      : `${a === 'packaged' ? 'packaged with this publication' : 'your font'}: ${faces.map((f) => `${f.subfamily} (${f.format.toUpperCase()}${f.embeddable ? '' : ', not embedded'})`).join(', ')}`;
    return `<li style="font-family:'${esc(n)}'">${esc(n)} <span class="ql-help">— ${esc(how)}</span></li>`;
  });
  await openDialog({ title: 'Fonts Used', ok: 'Close', cancel: false, fields: [{ key: 'i', type: 'info', html: rows.length ? `<ul>${rows.join('')}</ul>` : '<p>Only the default fonts are used.</p>' }], buttons: [{ label: 'Fonts…', onClick: (_v, ctl) => { ctl.close(); void openFontsDialog(app); } }, { label: 'Replace Fonts…', onClick: (_v, ctl) => { ctl.close(); app.exec('edit.replaceFonts'); } }] });
}

export { isUserFamily };
