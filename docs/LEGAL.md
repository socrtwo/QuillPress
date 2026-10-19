# Clean-room, trademark and licensing notes

This file records how QuillPress provides a complete page layout command set while avoiding other vendors' trademarks and copyrights. It follows the practice of the sister apps.

## What is reproduced, and why it is safe

- **Functionality and command names.** Page layout operations (New Page, Master Page, Link Frames, Autoflow, Text Wrap, Step and Repeat, Preflight, Package) are functional ideas, and their names are ordinary English words that every program in the field uses. Functionality is not protected by copyright; descriptive names are not trademarks.
- **Tab and group organization.** Grouping commands under tabs such as Home, Insert, Page Design, Text, Arrange, Review and View is a common, functional arrangement. QuillPress's grouping, ordering, labels, tooltips and icons are its own.
- **Keyboard shortcuts.** Long-standing shortcuts (Ctrl+S, Ctrl+Z, F7 for spelling, Ctrl+Shift+P for a new page) are functional conventions users rely on; all of them can be rebound.
- **File formats.** Scribus (.sla) is an open format developed by an open-source project; QuillPress reads and writes it from the public XML and the Scribus documentation, with original code. The native format is QuillPress's own. PDF is ISO 32000; the writer is original. Planned readers for other vendors' formats will work only from published specifications ([MS-PUB], IDML) and original observation.
- **Typographic conventions.** Justification, hyphenation, drop caps, paragraph rules, baseline grids and copy fitting are centuries-old craft; their implementations here are original.

## What is deliberately not reproduced

- No vendor logos, icons, splash screens, color schemes or trade dress. Command icons are Google's Material Symbols (Apache 2.0). The app icon and visual design are original.
- No vendor product names in the app's own name or interface. Trademarked or brand-specific feature names are replaced with generic terms:

| Vendor term | QuillPress term |
|---|---|
| InDesign, QuarkXPress, Publisher, PageMaker (as feature names) | appear only in file-type lists and in this file |
| Collect for Output / Package | Package Publication (`file.package`) |
| Story Editor (several programs) | Story Editor (generic; the name is descriptive) |
| Smart Guides | Smart Guides (descriptive; the behavior is original) |
| Paste in Place | Paste in Place (descriptive) |
| Design Checker | Preflight (`review.preflight`) |
| Building Blocks, Quick Parts | Templates and saved frames |
| Layout Guides | Layout Guides (descriptive) |
| Lorem ipsum text | original placeholder paragraphs (`src/templates/lorem.ts`) |

- No templates, clip art, sample pictures, sample text or fonts copied from any program. The templates in `src/templates/` are drawn in code from the default styles.
- No decompiled, leaked or reverse-engineered source. File format readers are written from public specifications and from files the author made.

## Nominative use

Product names appear in the documentation and in file-type lists only to identify compatibility or the origin of an idea. They belong to their owners:

- Adobe, InDesign, PageMaker, FrameMaker, Illustrator, Photoshop and PostScript are trademarks of Adobe Inc.
- QuarkXPress is a trademark of Quark Software Inc.
- Microsoft, Microsoft Publisher, Word and Windows are trademarks of Microsoft Corporation.
- Affinity Publisher is a trademark of Serif (Europe) Ltd (Canva).
- Ventura Publisher was a product of Ventura Software, then Xerox and Corel; Corel is a trademark of Corel Corporation.
- Scribus is the name of an open-source project (GPL); QuillPress contains none of its code.
- Apple, macOS, iOS and iPadOS are trademarks of Apple Inc.; Android and Chrome are trademarks of Google LLC; Linux is a trademark of Linus Torvalds; Raspberry Pi is a trademark of Raspberry Pi Ltd.
- AI provider names (OpenAI, Anthropic, Google Gemini, Mistral, Groq, OpenRouter, Ollama, LM Studio and others) identify services the app can connect to.

QuillPress is not affiliated with, endorsed by, or sponsored by any of them.

## Third-party components

| Component | License | Use |
|---|---|---|
| Vite, TypeScript, vitest, Playwright, Electron, electron-builder | MIT / Apache 2.0 | build, test, desktop |
| Capacitor and plugins (core, app, filesystem, share, android, ios) | MIT | Android and iOS |
| JSZip | MIT | .qpp packages, Scribus export, packages |
| Material Symbols | Apache 2.0 | command icons |
| Fonts via Fontsource: Tinos, Arimo, Cousine, Carlito, Caladea (metric-compatible with common document fonts), Open Sans, Lato, Merriweather, EB Garamond, Libre Baskerville, Gelasio, Courier Prime | SIL OFL 1.1 / Apache 2.0 | bundled fonts |
| nspell, dictionary-en, dictionary-en-gb, dictionary-en-ca, dictionary-en-au | MIT (code), SCOWL and related dictionary licenses | English spelling |
| hunspell-asm | MIT (Hunspell itself: LGPL/GPL/MPL tri-license, used unmodified as a WebAssembly binary) | downloaded dictionaries for other languages |

The dictionaries the **Spelling Dictionaries** wizard downloads are listed with their licenses in `src/proof/dictionary-catalog.json`. The full notices ship in `public/third-party-notices.txt` (generated by `npm run notices`) and are shown by Help ▸ Third-Party Notices.

## Online services

QuillPress has no server. The only network use is what you start: AI providers you configure (see [AI.md](AI.md)), dictionary downloads from the catalog's sources, the Picture from Web Address command, and the Look Up command, which opens a dictionary web site in your browser.

## License

MIT. Copyright (c) 2026 Paul D Pruitt.
