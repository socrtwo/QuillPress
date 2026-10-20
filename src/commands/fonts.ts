/**
 * User-supplied fonts: the Fonts dialog, adding and removing font files, packaging fonts with a
 * publication, installing fonts that came inside a package, and the "fonts used" report.
 */
import { def } from './registry';
import type { App } from '../app';
import { pickFile } from '../ui/dom';
import { openDialog, toast } from '../ui/dialog';
import { loadPrefs } from '../prefs';
import { userFonts, userFont, removeUserFont, installUserFont, setPackageFonts, onPackagedFonts, type UserFont } from '../fonts';
import { openFontsDialog, openFontsUsedReport, addFontFiles, describeUserFont, FONT_ACCEPT } from '../ui/fontsDialog';

// The packaging switch lives in the registry (the .qpp writer reads it); the pref is its saved value.
try { setPackageFonts(loadPrefs().packageFonts !== false); } catch { /* no storage */ }

// A publication that opens with packaged fonts offers to keep them on this device.
onPackagedFonts((fonts: UserFont[]) => {
  const names = [...new Set(fonts.map((f) => f.family))];
  toast(`This publication brought ${fonts.length === 1 ? 'a font' : `${fonts.length} fonts`} (${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}) for this session`, {
    action: 'Install', ms: 8000, onAction: () => { void Promise.all(fonts.map((f) => installUserFont(f.id))).then(() => toast('Fonts installed on this device')); },
  });
});

const syncPackagePref = (app: App, on: boolean) => { app.prefs.packageFonts = on; setPackageFonts(on); app.savePrefs(); };

/** A list dialog of the user's fonts for Remove / Install. */
async function pickUserFont(title: string, fonts: UserFont[], ok: string): Promise<UserFont[]> {
  if (!fonts.length) { toast('No fonts to choose from. Use Fonts… to add some.'); return []; }
  const r = await openDialog({ title, ok, fields: [{ key: 'f', label: 'Fonts', type: 'list', multiple: true, rows: Math.min(10, Math.max(4, fonts.length)), options: fonts.map((f) => ({ value: f.id, label: describeUserFont(f), style: `font-family:"${f.family}";font-weight:${f.weight};font-style:${f.style}` })), value: [fonts[0].id] }] });
  if (!r) return [];
  const ids: string[] = Array.isArray(r.f) ? r.f : r.f ? [r.f] : [];
  return ids.map((id) => userFont(id)).filter((f): f is UserFont => !!f);
}

def([
  {
    id: 'fonts.manage', label: 'Fonts…', icon: 'font_download', tab: 'Text', group: 'Typography', noRecord: true, popular: true,
    tip: 'Add your own font files (TTF, OTF, TTC, WOFF, WOFF2), remove them, install packaged fonts and choose whether fonts travel with the publication',
    keywords: 'font file install add remove package embed license',
    run: (app) => openFontsDialog(app),
  },
  {
    id: 'fonts.add', label: 'Add Font Files…', icon: 'add_circle', tab: 'Text', group: 'Typography', noRecord: true,
    tip: 'Add TrueType, OpenType, collection, WOFF or WOFF2 files; they stay on this device',
    run: async (_app, arg?: File[] | { bytes: Uint8Array; name: string }[]) => {
      let files: File[];
      if (Array.isArray(arg) && arg.length && !(arg[0] instanceof File)) {
        const { addUserFont } = await import('../fonts');
        const out: UserFont[] = [];
        for (const a of arg as { bytes: Uint8Array; name: string }[]) out.push(await addUserFont(a.bytes, a.name));
        return out;
      }
      files = Array.isArray(arg) ? (arg as File[]) : await pickFile(FONT_ACCEPT, true);
      if (!files.length) return [];
      return addFontFiles(files);
    },
  },
  {
    id: 'fonts.remove', label: 'Remove Font…', icon: 'delete', tab: 'Text', group: 'Typography', noRecord: true,
    tip: 'Remove one of your fonts from this device',
    isEnabled: () => userFonts().length > 0,
    run: async (_app, arg?: string) => {
      const picked = arg ? [userFont(arg)].filter((f): f is UserFont => !!f) : await pickUserFont('Remove Font', userFonts(), 'Remove');
      for (const f of picked) await removeUserFont(f.id);
      if (picked.length) toast(`Removed ${picked.length === 1 ? `${picked[0].family} ${picked[0].subfamily}` : `${picked.length} fonts`}`);
      return picked.length;
    },
  },
  {
    id: 'fonts.package', label: 'Package Fonts', icon: 'inventory_2', tab: 'Text', group: 'Typography', kind: 'toggle', noRecord: true,
    tip: 'Write the fonts a publication uses into its .qpp file so it opens with them elsewhere (fonts whose license forbids embedding are left out)',
    isActive: (app) => app.prefs.packageFonts !== false,
    run: (app, arg?: boolean) => { const on = typeof arg === 'boolean' ? arg : app.prefs.packageFonts === false; syncPackagePref(app, on); toast(on ? 'Fonts are packaged with publications' : 'Fonts are not packaged with publications'); },
  },
  {
    id: 'fonts.unpackage', label: 'Forget Packaged Fonts', icon: 'unarchive', tab: 'Text', group: 'Typography', noRecord: true,
    tip: 'Drop the fonts that came with a publication package from this session (installed fonts stay)',
    isEnabled: () => userFonts().some((f) => f.packaged),
    run: async () => {
      const pk = userFonts().filter((f) => f.packaged);
      for (const f of pk) await removeUserFont(f.id);
      toast(pk.length ? `Forgot ${pk.length} packaged font${pk.length === 1 ? '' : 's'}` : 'No packaged fonts in this session');
      return pk.length;
    },
  },
  {
    id: 'fonts.installPackaged', label: 'Install Packaged Fonts', icon: 'download', tab: 'Text', group: 'Typography', noRecord: true,
    tip: 'Keep the fonts that came with this publication on this device',
    isEnabled: () => userFonts().some((f) => f.packaged),
    run: async (_app, arg?: string[]) => {
      const pk = userFonts().filter((f) => f.packaged && (!arg || arg.includes(f.id)));
      const picked = arg || pk.length <= 1 ? pk : await pickUserFont('Install Packaged Fonts', pk, 'Install');
      for (const f of picked) await installUserFont(f.id);
      toast(picked.length ? `Installed ${picked.length} font${picked.length === 1 ? '' : 's'} on this device` : 'No packaged fonts to install');
      return picked.length;
    },
  },
  {
    id: 'fonts.usedReport', label: 'Fonts Used Report', icon: 'summarize', tab: 'Text', group: 'Typography', noRecord: true,
    tip: 'Every font the publication uses and how it is served: bundled, yours, packaged or missing',
    run: (app) => openFontsUsedReport(app),
  },
]);
