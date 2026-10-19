# Contributing to QuillPress

Thank you for your interest. QuillPress is a first working version; the most useful contributions are:

- **Bug reports** with the steps and, when the problem involves a file, a publication you made yourself (or that is openly licensed). Use the *Bug report* template.
- **Missing commands and ideas** from other page layout software, with corrections to [docs/INNOVATIONS.md](docs/INNOVATIONS.md) or [docs/QAT.md](docs/QAT.md). Use the *Feature request* template.
- **Test files:** Scribus documents that exercise unusual features, and damaged .qpp or .sla files for the recovery engine. Do not attach files you do not have the right to share or that contain private information.

## Ground rules

- **Clean room.** Do not contribute code, text, templates, images, sounds or icons copied from proprietary software, its documentation or its help files, and do not consult leaked or decompiled source. Work from public specifications, open-source references and your own observation of behavior. See [docs/LEGAL.md](docs/LEGAL.md).
- **Generic names.** Use the generic terms in docs/LEGAL.md in the interface and code (Text Frame, Master Page, Step and Repeat, Preflight, Package…). Vendor product names belong only in file-type lists and in the nominative-use sections of the docs.
- **No missing commands.** Every new feature is a command in `src/commands/*.ts` with an id, label, icon, tab and group (or *not in tabs*), so it can be placed on the Quick Access Bar, custom tabs, shortcuts and macros and found by command search. Add the id to [docs/COMMANDS-PLAN.md](docs/COMMANDS-PLAN.md) and run `npm run catalog`.
- **American English** in the interface, code comments and documentation.
- **Licenses.** Contributions are accepted under the MIT License. New dependencies must use a permissive license (MIT, BSD, Apache 2.0, ISC, SIL OFL for fonts).

## Workflow

```bash
npm ci
npm run dev        # web app at http://localhost:5173
npm run typecheck
npm test           # unit tests (vitest)
npm run build
npm run catalog    # regenerates docs/COMMANDS.md (a test fails when it is stale)
npm run e2e        # Playwright smoke test against the production build
```

Keep pull requests focused, include tests for model, text flow, file-format and recovery changes, and run the type check, the tests and the catalog before submitting. The shared shell files (`src/ui/shell.ts`, `src/ui/dialog.ts`, `src/ai/*`, `src/proof/*`, `src/platform/native.ts`…) are kept as close to the sister apps as possible so fixes port across the suite; change them only for what QuillPress needs.
