// electron-builder configuration for the desktop releases.
// Windows: NSIS installer (x64, arm64) and a portable .exe (x64).
// macOS: universal (Apple silicon + Intel) .dmg and .zip, ad-hoc signed.
// Linux: AppImage and .deb for x64, arm64 (Raspberry Pi OS 64-bit, ChromeOS Linux on ARM) and
// armv7l (Raspberry Pi OS 32-bit).
/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'io.github.socrtwo.quillpress',
  productName: 'QuillPress',
  copyright: 'QuillPress contributors, MIT License',
  directories: { app: 'build/desktop-app', output: 'release', buildResources: 'resources' },
  artifactName: 'QuillPress-${version}-${os}-${arch}.${ext}',
  asar: true,
  // Everything the app needs is bundled into dist/ by Vite; ship no node_modules.
  files: ['dist/**/*', 'electron/**/*', 'package.json', '!**/node_modules/**'],
  icon: 'resources/icon-1024.png',
  fileAssociations: [
    { ext: 'qpp', name: 'QuillPress Publication', role: 'Editor', mimeType: 'application/x-quillpress' },
    { ext: 'qppe', name: 'Encrypted QuillPress Publication', role: 'Editor', mimeType: 'application/x-quillpress-encrypted' },
    { ext: 'sla', name: 'Scribus Document', role: 'Editor', mimeType: 'application/x-scribus' },
  ],
  win: {
    target: [{ target: 'nsis', arch: ['x64', 'arm64'] }, { target: 'portable', arch: ['x64'] }],
  },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, artifactName: 'QuillPress-${version}-windows-${arch}-setup.${ext}' },
  portable: { artifactName: 'QuillPress-${version}-windows-portable.${ext}' },
  mac: {
    target: [{ target: 'dmg', arch: ['universal'] }, { target: 'zip', arch: ['universal'] }],
    category: 'public.app-category.productivity',
    extendInfo: { CFBundleDisplayName: 'QuillPress' },
    // Ad-hoc signature: runs on Apple silicon without a paid Developer ID, but is not notarized,
    // so Gatekeeper asks once (docs/INSTALL.md). Hardened runtime would reject Electron's own signature.
    identity: '-',
    hardenedRuntime: false,
    gatekeeperAssess: false,
  },
  linux: {
    target: [{ target: 'AppImage', arch: ['x64', 'arm64', 'armv7l'] }, { target: 'deb', arch: ['x64', 'arm64', 'armv7l'] }],
    category: 'Office;Publishing;Graphics',
    synopsis: 'Desktop publishing and page layout app with a complete, customizable command library',
    description: 'QuillPress is an open-source desktop publishing app: frame-based pages, master pages, linked text frames, styles, pictures and tables, with PDF export and Scribus (.sla) compatibility. Every feature is a command you can put on the ribbon, the Quick Access Bar, a shortcut or a macro.',
    maintainer: 'socrtwo <socrtwo@users.noreply.github.com>',
    executableName: 'quillpress',
    syncDesktopName: true,
  },
  publish: null,
};
