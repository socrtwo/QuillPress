# Recovering damaged publications

QuillPress inherits the suite's recovery engine, which descends from the author's tools: byte-level ZIP salvage and the ImmortalInflate decoder of [Immortal Unzipper / Immortal Zip](https://socrtwo.github.io/Immortal-Zip/), XML healing and strings scans from [Word Recovery](https://github.com/socrtwo/wordrecovery-SF), and the S2 File Identifier.

## When it runs

- **Automatically**, when a file fails to open normally. `importPublication` (`src/io/index.ts`) then returns the best recovered publication together with the report.
- **On purpose**, from *File ▸ Open ▸ Open and Repair* (`file.openRepair`, which calls `importPublication(…, { repair: true })` and runs every method even on a file that opens).
- From *Recover Data from Any File* (`file.recoverAny`) and the Manual Recovery Options dialog (`src/ui/recovery.ts`), which accept any file.

The report (`RecoveryReport`, shown by `showRecoveryReport`) lists each method, what it found, and whether some content comes from a damaged area and should be checked. The app opens the recovered publication as "*name* (Recovered)", unsaved, so the damaged original is not overwritten. For ZIP-based files the report also offers the **repaired package** itself (a clean .qpp).

## The methods (`src/io/recover/index.ts`)

| Method | What it does |
|---|---|
| **Identify** | Reads the bytes, not the name (`fileid.ts`): ZIP with the QuillPress mimetype, Scribus XML, JSON, text, pictures, other office files, archives. Reports when the name and content disagree, and when several files were concatenated. Encrypted `.qppe` files stop here: nothing can be repaired without the password. |
| **Open** | The normal reader. If it succeeds (or Open and Repair was not asked for), this is the result. |
| **ZIP salvage** | Walks the local file headers of a `.qpp` whose central directory is missing or wrong (truncated downloads, interrupted saves), inflates each entry with ImmortalInflate, which resynchronizes past damaged blocks instead of giving up, and rebuilds `publication.json` and `media/`. Entries that cannot be read are listed as lost. |
| **JSON repair** | A truncated or corrupted `publication.json`: cuts the text at the last complete page, item, story or style, closes the open brackets and strings (`repairJsonText`), and sanitizes the result (`Pub.fromJSON` fills in anything missing). |
| **Scribus repair** | A damaged `.sla`: balances the XML, cuts at the last complete `PAGEOBJECT`, drops unparsable elements, and reads what remains with the normal Scribus reader. |
| **Picture harvest** | Scans the raw bytes for picture signatures (PNG, JPEG, GIF, WebP, BMP, TIFF, SVG) and extracts every picture, however the container was damaged (`harvestMediaBytes`). Harvested pictures are placed on pages when no layout could be recovered. |
| **Text scan** | Pulls readable text out of JSON or XML fragments: paragraphs and runs from `"text":` values and `ITEXT CH=` attributes. |
| **Strings scan** | The last resort: runs of readable characters anywhere in the file, as one text frame per block (`pubFromText`). The report marks this result *unverified*. |

The best result is chosen by what it contains (pages, objects, words, pictures) weighted by the method's reliability; every method's outcome stays in the report so you can see what was lost.

## Reading the report

- **Recovered N pages, M objects and W words with …** says which method produced the publication.
- **Only text was recovered** means the layout is gone: the text comes back in one frame per page or block, in the default styles.
- **Unverified** content (strings scan) may contain fragments of styles, file names or binary noise between the real text.
- **Lost parts** lists ZIP entries that could not be read at all (usually pictures); the frames remain, empty, so you can place the pictures again.

## Manual options

When nothing works, the dialog (`file.recoveryHelp`) lists what to try: open the file with Scribus or another program and save a copy; look for the previous version in your backups or cloud history; for a `.qpp`, rename it `.zip` and inspect it; and the author's online S2 tools, which handle other formats. QuillPress's own drafts (AutoSave) and snapshots (File ▸ Info ▸ Version History) are separate copies kept on the device, so a damaged file on disk rarely means lost work.

## Tests

`tests/unit/recover.test.ts` damages publications in code (truncated ZIPs, cut JSON, cut Scribus XML, mangled ZIP signatures, plain text) and checks that each method recovers what it should.
