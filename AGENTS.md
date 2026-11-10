# Readwise Reader Archive importer

- 代码提交、PR 合并、同步与共享边界遵守 [CONTRIBUTING.md](CONTRIBUTING.md)。历史任务授权、私人账号及生产数据权限不随源码共享转移给其他成员或 Agent。

- Scope: manually import Reader Archive originals and native annotations into the existing Obsidian Local IR workflow. Never write to RemNote.
- Entry: `pwsh -NoLogo -NoProfile -File D:\Projects\ReadwiseReaderArchiveImporter\Import.ps1`; Obsidian QuickAdd calls quickadd.cjs. `-UseCache` is only for a cached run.
- Stack: Node built-in APIs plus the maintained workflow's jsdom/Turndown/core; bundled Python pdfplumber/pypdfium2 and the existing EPUB extractor. No model, MinerU or OCR calls.
- Runtime/source data lives in D:\AppData and D:\Artifacts, with recoverable backups in D:\Quarantine. No tokens, signed URLs, source books, annotations or personal exception IDs in Git. Local policy.json is authoritative; policy.example.json has no personal IDs.
- Source URL deduplication and local edit protection are mandatory. Existing Markdown/reading state stays intact during annotation merges. Hold a whole document when any Reader highlight cannot be located. Accepted EPUB metadata/link warnings never permit missing chapters or images.
- Check: `node convert.test.mjs`; `node verify.mjs` verifies this run, `node verify.mjs --all` independently verifies the imported registry. Source snapshots must finish pagination before replacing the previous snapshot.
- The private repository is the only maintained implementation. The workflow's QuickAdd script is a small installed adapter. Keep the user's unrelated workflow edits.
