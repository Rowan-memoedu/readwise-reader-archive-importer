import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaults, loadSnapshot } from './audit.mjs';
import { canonicalUrl, convertHtml, loadDependencies, sha, locateQuoteWithContext, combineNotes } from './convert.mjs';

const ROOT = '04 Projects/渐进阅读工作流';
const pending = `${ROOT}/待归档原文`;
const registryPath = path.join(defaults.cache, 'import-registry.json');
const readJson = async file => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
async function files(folder) {
  const result = [];
  for (const entry of await fs.readdir(folder, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(folder, entry.name);
    if (entry.isDirectory()) result.push(...await files(p)); else if (entry.name.endsWith('.md')) result.push(p);
  }
  return result;
}
const sourceUrl = doc => canonicalUrl(doc.source_url || doc.url);
function filename(doc) {
  const title = String(doc.title || doc.id).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 70);
  return `${title} — ${doc.id}.md`;
}
function frontmatter(doc) {
  return `---\nsource_url: ${JSON.stringify(sourceUrl(doc))}\nreadwise_reader_url: ${JSON.stringify(doc.url)}\nreadwise_reader_id: ${JSON.stringify(doc.id)}\nreadwise_category: ${JSON.stringify(doc.category)}\nreadwise_location: archive\nconversion_method: deterministic_no_llm\n---\n\n`;
}
export function rebase(body, annotations, prefix, id) {
  const edits = [...body.matchAll(/\]\((assets\/[^)]*)\)/g)].map(m => ({ start: m.index + 2, end: m.index + 2 + m[1].length,
    value: `../附件/Readwise/${id}/${m[1].slice(7)}` }));
  let output = body;
  for (const edit of [...edits].reverse()) output = output.slice(0, edit.start) + edit.value + output.slice(edit.end);
  const offset = at => prefix.length + at + edits.filter(e => e.end <= at).reduce((n, e) => n + e.value.length - (e.end - e.start), 0);
  output = prefix + output;
  const mapped = annotations.map(annotation => {
    const ranges = annotation.virtualRanges.map(r => {
      let start = offset(r.start), end = offset(r.end);
      while (start < end && /\s/u.test(output[start])) start++;
      while (end > start && /\s/u.test(output[end - 1])) end--;
      return { start, end };
    });
    const range = { start: ranges[0].start, end: ranges.at(-1).end }, text = output.slice(range.start, range.end);
    return { ...annotation, range, virtualRanges: ranges, sourceOffset: range.start,
      selectedText: text, originalText: text, currentText: text,
      contextBefore: output.slice(Math.max(0, range.start - 80), range.start), contextAfter: output.slice(range.end, range.end + 80),
      fragments: ranges.map((r, index) => ({ index, text: output.slice(r.start, r.end), sourceRange: r,
        contextBefore: output.slice(Math.max(0, r.start - 80), r.start), contextAfter: output.slice(r.end, r.end + 80) })) };
  });
  return { body: output, annotations: mapped };
}
export async function plan() {
  const policy = await readJson(path.join(defaults.cache, 'policy.json'));
  if (policy.unlocatedHighlights !== 'hold_whole_document') throw Error('Unsupported unlocated-highlight policy');
  const snapshot = await loadSnapshot(defaults.cache), deps = loadDependencies(defaults.workflow);
  const core = (await import(pathToFileURL(defaults.workflow + '/document-core/index.mjs'))).default;
  const registry = await readJson(registryPath).catch(() => ({ documents: {} }));
  const local = await readJson(path.join(defaults.vault, '.obsidian/plugins/local-ir/data.json'));
  const binary = await readJson(path.join(defaults.artifacts, 'binary-import-audit.json'));
  const existing = new Map();
  for (const folder of ['阅读区', '待归档原文', '已归档原文']) for (const file of await files(path.join(defaults.workflow, folder))) {
    const body = await fs.readFile(file, 'utf8');
    const raw = body.match(/^source_url:\s*(.+)$/m)?.[1];
    if (!raw) continue;
    let value = raw.trim(); try { value = JSON.parse(value); } catch { value = value.replace(/^['"]|['"]$/g, ''); }
    const url = canonicalUrl(value);
    if (url) { if (!existing.has(url)) existing.set(url, []); existing.get(url).push(path.relative(defaults.vault, file).replaceAll('\\', '/')); }
  }
  const stageFolder = path.join(defaults.artifacts, 'staged'); await fs.mkdir(stageFolder, { recursive: true });
  const result = { createdAt: new Date().toISOString(), documents: [], vault: defaults.vault,
    limit: Number(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || 0) };
  const reserved = new Set();
  for (const doc of snapshot.archive) {
    if (policy.excludedReaderIds[doc.id]) {
      result.documents.push({ id: doc.id, title: doc.title, category: doc.category, action: 'excluded', reason: policy.excludedReaderIds[doc.id] });
      continue;
    }
    const highlights = snapshot.highlight.filter(h => h.parent_id === doc.id);
    const sourceDocument = Object.fromEntries(['id', 'title', 'author', 'category', 'source_url', 'url', 'notes', 'html_content', 'tags'].map(k => [k, doc[k]]));
    const fingerprint = sha(JSON.stringify({ doc: sourceDocument,
      highlights: highlights.map(h => Object.fromEntries(['id', 'content', 'notes', 'highlight_location', 'highlight_offset', 'tags'].map(k => [k, h[k]]))),
      notes: snapshot.note.filter(n => n.parent_id === doc.id || highlights.some(h => h.id === n.parent_id)).map(n => ({ id: n.id, parent_id: n.parent_id, content: n.content })) }));
    const prior = registry.documents[doc.id];
    const entry = { id: doc.id, title: doc.title, category: doc.category, readerUrl: doc.url, sourceUrl: sourceUrl(doc), fingerprint,
      markdownPath: prior?.markdownPath || `${pending}/${filename(doc)}` };
    let mergePath = prior?.ownsMarkdown === false ? prior.markdownPath : '';
    if (prior && prior.fingerprint === fingerprint) {
      if (await fs.access(path.join(defaults.vault, prior.markdownPath)).then(() => true, () => false)) { entry.action = 'unchanged'; result.documents.push(entry); continue; }
      entry.action = 'held'; entry.reason = 'previously_imported_file_missing_or_moved'; result.documents.push(entry); continue;
    }
    if (prior) {
      const unchanged = await fs.readFile(path.join(defaults.vault, prior.markdownPath)).then(v => sha(v) === prior.markdownSha256, () => false);
      const stateUnchanged = await fs.readFile(path.join(defaults.vault, prior.sidecarPath)).then(v => sha(v) === prior.sidecarSha256, () => false);
      if (!unchanged || !stateUnchanged) { entry.action = 'held'; entry.reason = 'local_edits_or_document_move'; result.documents.push(entry); continue; }
    } else if (existing.has(entry.sourceUrl) || reserved.has(entry.sourceUrl)) {
      entry.existingPaths = existing.get(entry.sourceUrl) || [];
      if (entry.existingPaths.length !== 1 || ['epub', 'pdf'].includes(doc.category)) {
        entry.action = 'held'; entry.reason = 'source_url_already_exists'; result.documents.push(entry); continue;
      }
      mergePath = entry.existingPaths[0];
    }
    let converted, assets = [], warnings = [];
    if (['epub', 'pdf'].includes(doc.category)) {
      const audit = binary.find(d => d.id === doc.id);
      if (!audit?.sourceAndAssetsVerified || audit.issues?.length || audit.error || audit.nativeImport !== 'passed') {
        entry.action = 'held'; entry.reason = audit?.error || 'binary_highlights_not_fully_located'; entry.issues = audit?.issues;
        result.documents.push(entry); continue;
      }
      if (doc.category === 'epub' && audit.quality.images_extracted < audit.quality.images_selected) {
        entry.action = 'held'; entry.reason = 'epub_images_incomplete'; result.documents.push(entry); continue;
      }
      // User decision: accept EPUB metadata/internal-link source warnings
      // when full body/chapter extraction and all highlight positions survive.
      if (audit.status !== 'completed' && (policy.epubSourceWarnings !== 'accept_when_body_and_highlights_complete' || doc.category !== 'epub' || audit.quality.chapters_failed || audit.quality.chapters_extracted !== audit.quality.spine_items)) {
        entry.action = 'held'; entry.reason = 'incomplete_binary_conversion'; result.documents.push(entry); continue;
      }
      const fixture = await readJson(path.join(defaults.artifacts, 'validation-states', doc.id + '.json'));
      converted = { body: await fs.readFile(fixture.markdownFile, 'utf8'), annotations: fixture.state.annotations, articleMusing: fixture.state.articleMusing, issues: [] };
      const manifest = await readJson(path.join(fixture.packagePath, 'manifest.json'));
      assets = manifest.assets.map(a => ({ source: path.join(fixture.packagePath, a.package_path),
        target: `${ROOT}/附件/Readwise/${doc.id}/${a.package_path.replace(/^assets\//, '')}`, sha256: a.sha256 }));
      warnings = audit.warnings || [];
    } else converted = convertHtml(doc, highlights, snapshot.note, deps);
    if (converted.issues.length || converted.annotations.length !== highlights.length) {
      entry.action = 'held'; entry.reason = 'highlights_missing_or_ambiguous'; entry.issues = converted.issues;
      result.documents.push(entry); continue;
    }
    let mapped = rebase(converted.body, converted.annotations, frontmatter(doc), doc.id), cards = [], musing = converted.articleMusing;
    let preservedCollections = null, expectedStatus = 'done';
    if (mergePath) {
      entry.markdownPath = mergePath;
      const original = await fs.readFile(path.join(defaults.vault, mergePath), 'utf8');
      const incoming = converted.annotations.map(a => {
        const range = locateQuoteWithContext(original, a.readwise.originalQuote || a.selectedText, a.fragments?.[0]);
        if (range.issue) return { issue: range.issue, id: a.id };
        const text = original.slice(range.start, range.end);
        return { ...a, range, virtualRanges: [range], sourceOffset: range.start, selectedText: text, originalText: text, currentText: text,
          contextBefore: original.slice(Math.max(0,range.start-80),range.start), contextAfter: original.slice(range.end,range.end+80),
          fragments: [{ index: 0, text, sourceRange: range }] };
      });
      if (incoming.some(a => a.issue)) { entry.action = 'held'; entry.reason = 'existing_source_highlights_not_fully_located'; entry.issues = incoming.filter(a=>a.issue); result.documents.push(entry); continue; }
      preservedCollections = { annotations: Object.values(local.annotations).filter(a=>a.path===mergePath).sort((a,b)=>a.id.localeCompare(b.id)),
        qaCards: Object.values(local.qaCards).filter(a=>a.path===mergePath).sort((a,b)=>a.id.localeCompare(b.id)), articleMusing: local.articleMusings[mergePath] || null };
      if (!incoming.length && !converted.articleMusing) { entry.action = 'already_present'; result.documents.push(entry); continue; }
      const merged = new Map(preservedCollections.annotations.map(a=>[a.id,a]));
      for (const annotation of incoming) merged.set(annotation.id, annotation);
      mapped = { body: original, annotations: [...merged.values()] }; cards = preservedCollections.qaCards;
      const musingText = combineNotes([preservedCollections.articleMusing?.bodyMarkdown || '', converted.articleMusing?.bodyMarkdown || '']);
      musing = musingText ? { ...(preservedCollections.articleMusing || converted.articleMusing), bodyMarkdown: musingText } : null;
      expectedStatus = local.records[mergePath]?.status || (mergePath.startsWith(pending + '/') ? 'done' : 'inbox');
      entry.expectedMarkdownSha256 = sha(original); entry.expectedCollectionsSha256 = sha(JSON.stringify(preservedCollections));
      entry.ownsMarkdown = false;
    }
    const state = core.normalizeDocumentState({ document: { id: `readwise-${doc.id}`, path: entry.markdownPath,
      title: doc.title || doc.id, sourceUrl: entry.sourceUrl, sourceType: `readwise_${doc.category}`, status: expectedStatus, revision: (prior?.revision || 0) + 1,
      createdAt: doc.created_at, updatedAt: doc.updated_at },
      content: { markdownSha256: sha(mapped.body), rawMarkdownSha256: sha(converted.body), conversionMethod: 'deterministic_no_llm' },
      annotations: mapped.annotations, qaCards: cards, articleMusing: musing,
      browser: { destination: 'completed', sourceMetadata: { source_url: entry.sourceUrl, source_title: doc.title,
        readwise_reader_id: doc.id, readwise_category: doc.category, readwise_location: 'archive', source_warnings: warnings } } });
    const anchored = core.anchorAnnotationsToMarkdown(state.annotations, mapped.body, entry.markdownPath);
    for (const expected of state.annotations) {
      const actual = anchored.find(a => a.id === expected.id);
      if (actual.orphaned || actual.range.start !== expected.range.start || actual.range.end !== expected.range.end) throw Error(`Staged highlight failed: ${doc.id}`);
    }
    entry.action = mergePath ? 'merge' : prior ? 'update' : 'create';
    entry.expectedStatus = expectedStatus;
    if (!mergePath) entry.expectedMarkdownSha256 = prior?.markdownSha256;
    entry.expectedSidecarSha256 = prior?.sidecarSha256;
    entry.sidecarPath = `${ROOT}/.local-ir/browser-document-state/${path.basename(entry.markdownPath)}.browser-ir.json`;
    entry.stagedMarkdown = path.join(stageFolder, doc.id + '.md'); entry.stagedState = path.join(stageFolder, doc.id + '.json');
    entry.highlightCount = highlights.length; entry.commentCount = state.annotations.filter(a => a.commentMarkdown).length;
    entry.musing = Boolean(state.articleMusing); entry.assets = assets; entry.warnings = warnings;
    await fs.writeFile(entry.stagedMarkdown, mapped.body); await fs.writeFile(entry.stagedState, JSON.stringify(state, null, 2));
    reserved.add(entry.sourceUrl); result.documents.push(entry);
  }
  await fs.writeFile(path.join(defaults.artifacts, 'import-plan.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(Object.fromEntries(['create', 'update', 'merge', 'already_present', 'unchanged', 'held', 'excluded'].map(action => [action, result.documents.filter(d => d.action === action).length]))));
  return result;
}
export async function recordApplied() {
  const plan = await readJson(path.join(defaults.artifacts, 'import-plan.json'));
  const receipt = await readJson(path.join(defaults.artifacts, 'native-import-result.json'));
  const registry = await readJson(registryPath).catch(() => ({ documents: {} }));
  for (const applied of receipt.documents) {
    const entry = plan.documents.find(d => d.id === applied.id);
    if (!entry || !applied.passed) throw Error('Missing native import proof');
    registry.documents[entry.id] = { fingerprint: entry.fingerprint, markdownPath: entry.markdownPath, sidecarPath: entry.sidecarPath,
      markdownSha256: sha(await fs.readFile(path.join(defaults.vault, entry.markdownPath))),
      sidecarSha256: sha(await fs.readFile(path.join(defaults.vault, entry.sidecarPath))), revision: applied.revision, ownsMarkdown: entry.ownsMarkdown !== false,
      assets: (entry.assets || []).map(a=>({target:a.target,sha256:a.sha256})) };
  }
  await fs.writeFile(registryPath, JSON.stringify(registry, null, 2));
  console.log(`Recorded ${receipt.documents.length} native imports`);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  (process.argv[2] === 'record' ? recordApplied() : plan()).catch(error => { console.error(error.message); process.exitCode = 1; });
}
