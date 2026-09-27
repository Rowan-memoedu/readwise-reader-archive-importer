import fs from 'node:fs/promises';
import path from 'node:path';
import { defaults } from './audit.mjs';
import { sha } from './convert.mjs';
const plan = JSON.parse(await fs.readFile(path.join(defaults.artifacts, 'import-plan.json'), 'utf8'));
const settings = JSON.parse(await fs.readFile(path.join(defaults.vault, '.obsidian/plugins/local-ir/data.json'), 'utf8'));
const registry = JSON.parse(await fs.readFile(path.join(defaults.cache, 'import-registry.json'), 'utf8'));
const receipt = JSON.parse(await fs.readFile(path.join(defaults.artifacts, 'native-import-result.json'), 'utf8'));
const verifyAll = process.argv.includes('--all');
const result = { documents: [], errors: [] };
for (const [id, saved] of Object.entries(registry.documents)) {
  if (!verifyAll && !receipt.documents.some(d=>d.id===id)) continue;
  const entry = { id, ...saved, stagedState: path.join(defaults.artifacts, 'staged', id + '.json'),
    assets: saved.assets || plan.documents.find(d=>d.id===id)?.assets || [] };
  if (!entry.assets.length) {
    try {
      const fixture = JSON.parse(await fs.readFile(path.join(defaults.artifacts,'validation-states',id+'.json'),'utf8'));
      const manifest = JSON.parse(await fs.readFile(path.join(fixture.packagePath,'manifest.json'),'utf8'));
      entry.assets = manifest.assets.map(a=>({ target:`04 Projects/渐进阅读工作流/附件/Readwise/${id}/${a.package_path.replace(/^assets\//,'')}`,sha256:a.sha256 }));
    } catch { /* Articles have no offline binary package. */ }
  }
  try {
    const expected = JSON.parse(await fs.readFile(entry.stagedState, 'utf8'));
    const markdown = await fs.readFile(path.join(defaults.vault, entry.markdownPath), 'utf8');
    if (sha(markdown) !== expected.content.markdownSha256) throw Error('Markdown differs from staged original');
    const record = settings.records[entry.markdownPath];
    if (record?.status !== expected.document.status || (entry.ownsMarkdown !== false && record.completedSourcePath !== entry.markdownPath)) throw Error('Document status is incorrect');
    const annotations = Object.values(settings.annotations).filter(a => a.path === entry.markdownPath);
    if (annotations.length !== expected.annotations.length) throw Error('Annotation count differs');
    for (const annotation of expected.annotations) {
      const actual = settings.annotations[annotation.id];
      if (!actual || actual.orphaned || actual.range.start !== annotation.range.start || actual.range.end !== annotation.range.end || actual.commentMarkdown !== annotation.commentMarkdown) throw Error('Annotation data differs');
      if (markdown.slice(actual.range.start, actual.range.end) !== annotation.originalText) throw Error('Highlight is on the wrong text');
    }
    if ((settings.articleMusings[entry.markdownPath]?.bodyMarkdown || '') !== (expected.articleMusing?.bodyMarkdown || '')) throw Error('Full musing differs');
    for (const card of expected.qaCards) if (JSON.stringify(settings.qaCards[card.id]) !== JSON.stringify(card)) throw Error('Existing QA card changed');
    for (const asset of entry.assets) if (sha(await fs.readFile(path.join(defaults.vault, asset.target))) !== asset.sha256) throw Error('Published asset differs');
    result.documents.push({ id: entry.id, annotations: annotations.length, comments: annotations.filter(a => a.commentMarkdown).length,
      musing: Boolean(expected.articleMusing), passed: true });
  } catch (error) { result.errors.push({ id: entry.id, message: error.message }); }
}
await fs.writeFile(path.join(defaults.artifacts, 'independent-import-verification.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ verified: result.documents.length, errors: result.errors,
  annotations: result.documents.reduce((n, d) => n + d.annotations, 0), comments: result.documents.reduce((n,d)=>n+d.comments,0), musings:result.documents.filter(d=>d.musing).length }));
if (result.errors.length) process.exitCode = 1;
