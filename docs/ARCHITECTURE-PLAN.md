# Architecture plan

- **Stack:** TypeScript, Vite, Capacitor, Electron; same CI and release workflows as QuillStage.
- **Shell:** shared command registry, Quick Access Bar, customizable tabs and keyboard, command search, macro recorder, AI wizard and providers.
- **Document model:** a lossless PDF object graph with page tree, annotations, form fields, outline, attachments, layer and metadata models.
- **Viewing:** fast renderer, selectable text layer, page cache, search index, comparison mode, accessibility tree.
- **Editing:** page operations, annotations, forms, signatures, redaction and OCR correction.
- **Export:** PDF, PDF/A, PDF/X, PDF/UA, images, text, portfolio packages.
- **Recovery:** pipeline in docs/REPAIR.md.
- **Security:** local processing by default, no upload unless user chooses a cloud provider; credentials in platform keystore.
