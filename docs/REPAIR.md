# PDF repair design

1. **Detect** broken structure and classify the damage.
2. **Repair xref and trailer** when possible.
3. **Rebuild object streams** and salvage intact objects.
4. **Recover pages, outlines, form fields, annotations and embedded files** from surviving references.
5. **Linearize or sanitize** if needed for output.
6. **Report** what was recovered and what was lost, with a diff and preview.

Lineage: PDF repair uses the same recovery philosophy as XML Truncator-Fixer and Immortal Zip, but applied to PDF object structure and cross-reference tables rather than tags.
