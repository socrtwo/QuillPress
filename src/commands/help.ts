/** Help tab. */
import { def } from './registry';
import { openDialog, toast } from '../ui/dialog';
import { h } from '../ui/dom';
import { commandCount } from './registry';

declare const __APP_VERSION__: string;
const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const REPO = 'https://github.com/socrtwo/QuillPress';

async function open(url: string): Promise<void> {
  const { openExternal } = await import('../platform/native');
  openExternal(url);
}

def([
  {
    id: 'help.help', label: 'Help', icon: 'help', tab: 'Help', group: 'Help', keys: ['F1'], edits: false, noRecord: true,
    run: async () => {
      await openDialog({ title: 'QuillPress Help', wide: true, ok: 'Close', cancel: false, fields: [{ key: 'i', type: 'info', html: [
        '<p><b>Every feature is a command.</b> Search for any of them with Alt+Q (the magnifier in the title bar), put them on the Quick Access Bar, your own tabs or keyboard shortcuts, or record them in macros.</p>',
        '<p><b>Pages:</b> Insert Page (Ctrl+Shift+P), drag thumbnails to reorder, right-click (or long-press) for more. Pages are built on master pages (Page Design ▸ Edit Master Page) that carry folios, running heads and guides.</p>',
        '<p><b>Frames:</b> Everything on a page is a frame: text frames, picture frames, shapes, lines and tables. Drag to move, the handles resize, the top handle rotates; Shift keeps proportions. Double-click a text frame to type.</p>',
        '<p><b>Text flow:</b> Link frames (Text ▸ Link Frames) so a story runs from one frame to the next, across columns and pages. A red mark at the bottom of a frame means overset text; Autoflow adds pages until it fits.</p>',
        '<p><b>Styles:</b> Paragraph, character and object styles keep a publication consistent (Home ▸ Styles). Swatches, color schemes and font schemes live under Page Design.</p>',
        '<p><b>Files:</b> Opens and saves QuillPress publications (.qpp, encrypted .qppe) and Scribus documents (.sla); places text (.txt, .md, .rtf, .docx, .html) and pictures; exports PDF, SVG, PNG/JPEG, web pages and text. Damaged files are repaired on open.</p>',
        `<p>Documentation: <a href="${REPO}#readme" target="_blank" rel="noopener">${REPO}</a></p>`,
      ].join('') }] });
    },
  },
  { id: 'help.shortcuts', label: 'Keyboard Shortcuts', icon: 'keyboard', tab: 'Help', group: 'Help', edits: false, noRecord: true, run: (app) => app.ui.showShortcuts() },
  { id: 'help.commandReference', label: 'Command Reference', icon: 'menu_book', tab: 'Help', group: 'Help', edits: false, noRecord: true, tip: 'Every command, by tab', run: (app) => app.ui.showCommandReference() },
  { id: 'help.tour', label: 'Tour', icon: 'tour', tab: 'Help', group: 'Help', edits: false, noRecord: true, run: (app) => app.ui.tour() },
  { id: 'help.whatsNew', label: "What's New", icon: 'new_releases', tab: 'Help', group: 'Help', edits: false, noRecord: true, run: () => open(`${REPO}/releases`) },
  { id: 'help.feedback', label: 'Report a Problem / Feedback', icon: 'feedback', tab: 'Help', group: 'Help', edits: false, noRecord: true, run: () => open(`${REPO}/issues/new/choose`) },
  { id: 'help.updates', label: 'Check for Updates', icon: 'system_update', tab: 'Help', group: 'Help', edits: false, noRecord: true, tip: 'Open the releases page to compare with this version', run: () => open(`${REPO}/releases/latest`) },
  {
    id: 'help.notices', label: 'Third-Party Notices', icon: 'gavel', tab: 'Help', group: 'Help', edits: false, noRecord: true,
    run: async () => {
      let text = '';
      try { const r = await fetch('./third-party-notices.txt'); if (r.ok) text = await r.text(); } catch { /* offline or not built */ }
      if (!text) { toast('The notices file is part of release builds; see the repository for the license list.'); return; }
      const pre = h('pre', { style: 'white-space:pre-wrap;max-height:60vh;overflow:auto;font-size:12px' }, text);
      await openDialog({ title: 'Third-Party Notices', wide: true, ok: 'Close', cancel: false, content: pre });
    },
  },
  {
    id: 'help.about', label: 'About QuillPress', icon: 'info', tab: 'Help', group: 'Help', edits: false, noRecord: true,
    run: async () => {
      await openDialog({ title: 'About QuillPress', ok: 'Close', cancel: false, fields: [{ key: 'i', type: 'info', html: `<p><b>QuillPress ${VERSION}</b> — an original, open-source desktop publishing and page layout app. Part of the Quill suite (QuillPen, QuillGrid, QuillPost, QuillStage, QuillLoom, QuillFolio).</p><p>${commandCount()} commands, every one placeable on the Quick Access Bar, a tab, a shortcut or a macro.</p><p>MIT License. Copyright © 2026 Paul D Pruitt. Not affiliated with any publishing-software vendor; product names are used only to describe compatibility.</p><p><a href="${REPO}" target="_blank" rel="noopener">${REPO}</a></p>` }] });
    },
  },
]);
