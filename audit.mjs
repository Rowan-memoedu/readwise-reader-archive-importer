import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDependencies, convertHtml } from './convert.mjs';

export const defaults = {
  vault: 'D:/Workspaces/新建文件夹',
  workflow: 'D:/Workspaces/新建文件夹/04 Projects/渐进阅读工作流',
  cache: 'D:/AppData/ReadwiseReaderArchive',
  artifacts: 'D:/Artifacts/ReadwiseReaderArchive'
};
export async function loadSnapshot(cache) {
  const output = {};
  for (const category of ['archive', 'highlight', 'note']) {
    const pages = (await fs.readdir(cache)).filter(n => new RegExp(`^${category}-page-\\d+\\.json$`).test(n))
      .sort((a, b) => Number(a.match(/(\d+)\.json$/)[1]) - Number(b.match(/(\d+)\.json$/)[1]));
    const data = await Promise.all(pages.map(async n => JSON.parse((await fs.readFile(path.join(cache, n), 'utf8')).replace(/^\uFEFF/, ''))));
    if (!data.length || data.at(-1).nextPageCursor) throw Error(`Incomplete ${category} snapshot`);
    const map = new Map(data.flatMap(p => p.results).map(d => [d.id, d]));
    if (map.size !== data[0].count) throw Error(`${category} source count changed or snapshot incomplete`);
    output[category] = [...map.values()];
  }
  return output;
}
export async function runAudit(options = defaults) {
  const snapshot = await loadSnapshot(options.cache), deps = loadDependencies(options.workflow);
  const results = [];
  for (const doc of snapshot.archive) {
    const highlights = snapshot.highlight.filter(h => h.parent_id === doc.id);
    const converted = convertHtml(doc, highlights, snapshot.note, deps);
    results.push({ id: doc.id, category: doc.category, highlights: highlights.length,
      converted: converted.annotations?.length || 0, comments: converted.annotations?.filter(a => a.commentMarkdown).length || 0,
      musing: !!converted.articleMusing, bodyLength: converted.body?.length || 0, issues: converted.issues });
    console.log(`${doc.category} ${doc.id}: ${converted.annotations?.length || 0}/${highlights.length} highlights; ${converted.issues.length} issues`);
  }
  await fs.mkdir(options.artifacts, { recursive: true });
  await fs.writeFile(path.join(options.artifacts, 'conversion-audit.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ documents: results.length, passed: results.filter(x => !x.issues.length).length,
    failed: results.filter(x => x.issues.length), musings: results.filter(x => x.musing).length,
    comments: results.reduce((n, x) => n + x.comments, 0) }, null, 2));
  return results;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runAudit().catch(e => { console.error(e.message); process.exitCode = 1; });
}
