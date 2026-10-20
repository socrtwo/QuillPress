/**
 * Import from other page layout programs: InDesign (IDML packages and .indd documents), Microsoft
 * Publisher, QuarkXPress (documents and XPress Tags), PageMaker and FrameMaker MIF. The readers live
 * in src/io (idml.ts, mspub.ts, legacyLayout.ts, xpressTags.ts, mif.ts); File ▸ Open recognizes the
 * same files by content, and these commands only narrow the file picker.
 */
import { def } from './registry';
import { openDocument } from '../platform/native';
import { openBuffer } from './file';

const open = async (app: any, accept: string, mimes: string[]) => {
  const f = await openDocument(accept, mimes);
  if (!f) return;
  await openBuffer(app, f.data, f.name, f.uri);
  app.ui.hideBackstage();
};

def([
  {
    id: 'file.import.idml', label: 'Import InDesign (IDML)…', icon: 'auto_stories', tab: 'Backstage', group: 'Open', noRecord: true,
    tip: 'Open an InDesign Markup Language package: spreads, master pages, frames, stories, styles, colors; linked pictures by name',
    keywords: 'indesign idml adobe import', origin: 'IDML interchange (InDesign)',
    run: (app) => open(app, '.idml,.indd,.indt', ['application/vnd.adobe.indesign-idml-package', 'application/x-indesign', 'application/octet-stream', '*/*']),
  },
  {
    id: 'file.import.layoutFile', label: 'Import Publisher, QuarkXPress or PageMaker File…', icon: 'drive_file_move', tab: 'Backstage', group: 'Open', noRecord: true,
    tip: 'Recover the text and pictures of a .pub, .qxp, .qxd, .pmd, .p65 or .indd file (their layouts are not publicly documented) into frames you can lay out again',
    keywords: 'publisher pub quark xpress qxp pagemaker pmd indd import recover',
    run: (app) => open(app, '.pub,.qxp,.qxd,.qxt,.pmd,.p65,.pm6,.pmt,.indd', ['application/x-mspublisher', 'application/vnd.quark.quarkxpress', 'application/x-pagemaker', 'application/x-indesign', 'application/octet-stream', '*/*']),
  },
  {
    id: 'file.import.xpressTags', label: 'Import XPress Tags…', icon: 'code', tab: 'Backstage', group: 'Open', noRecord: true,
    tip: 'Open a QuarkXPress tagged-text export (.xtg): style sheets, paragraphs and character formatting',
    keywords: 'quark xpress tags xtg import', origin: 'XPress Tags (QuarkXPress)',
    run: (app) => open(app, '.xtg,.txt', ['text/x-xpress-tags', 'text/plain', '*/*']),
  },
  {
    id: 'file.import.mif', label: 'Import FrameMaker MIF…', icon: 'description', tab: 'Backstage', group: 'Open', noRecord: true,
    tip: 'Open a FrameMaker Interchange Format file: pages, text frames, text flows and paragraph formats',
    keywords: 'framemaker mif import', origin: 'Maker Interchange Format (FrameMaker)',
    run: (app) => open(app, '.mif', ['application/x-mif', 'text/plain', '*/*']),
  },
]);
