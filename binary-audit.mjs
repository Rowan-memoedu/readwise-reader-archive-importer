import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaults, loadSnapshot } from './audit.mjs';
import { locateQuoteWithContext, convertHtml, loadDependencies, noteText, combineNotes, sha } from './convert.mjs';

const snapshot = await loadSnapshot(defaults.cache), deps = loadDependencies(defaults.workflow);
const results = [];
for (const doc of snapshot.archive.filter(d => ['epub', 'pdf'].includes(d.category))) {
  let packagePath = `D:/Projects/渐进阅读工作流/imports/readwise-validation/${doc.id}`;
  if (doc.category === 'pdf') {
    try { await fs.access(packagePath + '-pdf-ordered/manifest.json'); packagePath += '-pdf-ordered'; } catch { /* Original package if ordered conversion has not run. */ }
  }
  const record = { id: doc.id, category: doc.category, title: doc.title, readerUrl: doc.url };
  try {
    const quality = JSON.parse(await fs.readFile(path.join(packagePath, 'quality.json'), 'utf8'));
    const manifest = JSON.parse(await fs.readFile(path.join(packagePath, 'manifest.json'), 'utf8'));
    const body = await fs.readFile(path.join(packagePath, 'raw.md'), 'utf8');
    record.status = quality.status;
    record.quality = quality.quality;
    record.warnings = quality.warnings;
    const highlights = snapshot.highlight.filter(h => h.parent_id === doc.id);
    const converted = highlights.length ? convertHtml(doc, highlights, snapshot.note, deps) : { annotations: [], articleMusing: null };
    const mapped = [], issues = [];
    const pdfPages = [...body.matchAll(/<!-- pdf-page:(\d+) -->/g)].map(m => ({ page: Number(m[1]), start: m.index }));
    for (let i = 0; i < pdfPages.length; i++) pdfPages[i].end = pdfPages[i+1]?.start || body.length;
    // Infer only a page bucket, and only after every uniquely matched source
    // highlight confirms it. No guessed character coordinates or fuzzy text.
    const pageEvidence = doc.category === 'pdf' ? highlights.map(h => {
      const match = locateQuoteWithContext(body, h.content);
      return match.issue ? null : { actual: pdfPages.find(p => match.start >= p.start && match.start < p.end)?.page,
        expected: Math.floor(h.highlight_offset / 1000000) };
    }).filter(Boolean) : [];
    const pdfPageBucketsVerified = pageEvidence.length >= 3 && pageEvidence.every(e => e.actual === e.expected);
    record.pdfPageBucketsVerified = pdfPageBucketsVerified;
    for (const h of highlights) {
      const prior = converted.annotations?.find(a => a.readwise.id === h.id);
      let range = locateQuoteWithContext(body, h.content, prior?.fragments?.[0]);
      if (range.issue && pdfPageBucketsVerified) {
        const page = pdfPages.find(p => p.page === Math.floor(h.highlight_offset / 1000000));
        const match = page && locateQuoteWithContext(body.slice(page.start, page.end), h.content);
        if (match && !match.issue) range = { start: page.start + match.start, end: page.start + match.end };
      }
      if (range.issue) { issues.push({ id: h.id, kind: range.issue }); continue; }
      const commentMarkdown = combineNotes([noteText(h.notes, deps), ...snapshot.note.filter(n => n.parent_id === h.id).map(n => noteText(n.content, deps))]);
      mapped.push({ ...(prior || {}), id: `readwise-${h.id}`, originalText: body.slice(range.start, range.end), selectedText: body.slice(range.start, range.end),
        currentText: body.slice(range.start, range.end), type: commentMarkdown ? 'comment' : 'highlight',
        commentMarkdown, sourceFormat: 'virtual', renderMode: 'virtual_decoration', readwise: { ...(prior?.readwise || {}), originalQuote: h.content },
        markKind: 'highlight', virtualRanges: [range], range, sourceOffset: range.start,
        contextBefore: body.slice(Math.max(0, range.start - 80), range.start), contextAfter: body.slice(range.end, range.end + 80),
        fragments: [{ index: 0, text: body.slice(range.start, range.end), sourceRange: range,
          contextBefore: body.slice(Math.max(0, range.start - 80), range.start), contextAfter: body.slice(range.end, range.end + 80) }],
        createdAt: h.created_at, updatedAt: h.updated_at, archived: false, orphaned: false });
    }
    record.highlights = highlights.length;
    record.mapped = mapped.length;
    record.issues = issues;
    record.assetCount = manifest.assets.length;
    const original = await fs.readFile(path.join(defaults.cache, 'originals', `${doc.id}.${doc.category}`));
    if (sha(original) !== manifest.source.sha256) throw Error('original source hash mismatch');
    for (const asset of manifest.assets) {
      const bytes = await fs.readFile(path.join(packagePath, asset.package_path));
      if (sha(bytes) !== asset.sha256) throw Error('asset hash mismatch');
    }
    record.sourceAndAssetsVerified = true;
    if (doc.category === 'pdf' && (pdfPages.length !== quality.quality.page_count || pdfPages.some((p, i) => p.page !== i + 1))) throw Error('PDF page coverage mismatch');
    // Real Local IR plugin method, isolated host; no settings or vault writes.
    const { host, plain } = await import(pathToFileURL('D:/Workspaces/新建文件夹/04 Projects/Obsidian Local Incremental Reading Plugin/test/document-core-host.mjs'));
    const mdPath = `validation/${doc.id}.md`, sidecar = `validation/${doc.id}.browser-ir.json`;
    const core = (await import(pathToFileURL(defaults.workflow + '/document-core/index.mjs'))).default;
    const state = core.normalizeDocumentState({ document: { id: doc.id, path: mdPath, title: doc.title,
      status: 'done', revision: 1, createdAt: doc.created_at, updatedAt: doc.updated_at },
      annotations: mapped.map(a => ({ ...a, path: mdPath })), qaCards: [], articleMusing: converted.articleMusing });
    const { plugin } = host([], body, mdPath);
    plugin.settings.qaCards = {}; plugin.settings.articleMusings = {};
    plugin.readDocumentStateSidecarAtPath = async () => ({ state: plain(state), sidecarPath: sidecar });
    plugin.isPathInCompletedSourceFolder = () => true;
    const imported = await plugin.importDocumentStateSidecarPath(mdPath, sidecar, body);
    const annotations = Object.values(plugin.settings.annotations);
    if (!imported || annotations.length !== mapped.length || annotations.some(a => a.orphaned)) throw Error(`native import validation failed: changed=${imported}, count=${annotations.length}/${mapped.length}, orphaned=${annotations.filter(a => a.orphaned).length}`);
    for (const expected of mapped) {
      const actual = annotations.find(a => a.id === expected.id);
      if (actual.range.start !== expected.range.start || actual.range.end !== expected.range.end || actual.commentMarkdown !== expected.commentMarkdown) throw Error('native import changed highlight location or attached note');
    }
    const repeated = await plugin.importDocumentStateSidecarPath(mdPath, sidecar, body);
    if (repeated || Object.keys(plugin.settings.annotations).length !== mapped.length) throw Error('native import not idempotent');
    record.nativeImport = 'passed';
    record.acceptance = quality.status === 'completed' && !issues.length ? 'passed' : 'held';
    await fs.mkdir(path.join(defaults.artifacts, 'validation-states'), { recursive: true });
    await fs.writeFile(path.join(defaults.artifacts, 'validation-states', doc.id + '.json'), JSON.stringify({ state, packagePath,
      markdownFile: path.join(packagePath, 'raw.md'), acceptance: record.acceptance }, null, 2));
  } catch (error) { record.acceptance = 'held'; record.error = error.code === 'ENOENT' ? 'original_source_or_package_unavailable' : error.message; }
  results.push(record);
  console.log(JSON.stringify({ id: record.id, category: record.category, status: record.status, highlights: record.highlights,
    mapped: record.mapped, nativeImport: record.nativeImport, acceptance: record.acceptance, error: record.error }));
}
await fs.writeFile(path.join(defaults.artifacts, 'binary-import-audit.json'), JSON.stringify(results, null, 2));
