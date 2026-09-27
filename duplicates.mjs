import fs from 'node:fs/promises';
import path from 'node:path';
import { defaults, loadSnapshot } from './audit.mjs';
import { locateQuoteWithContext } from './convert.mjs';
const snapshot = await loadSnapshot(defaults.cache);
const plan = JSON.parse(await fs.readFile(path.join(defaults.artifacts, 'import-plan.json'), 'utf8'));
const settings = JSON.parse(await fs.readFile(path.join(defaults.vault, '.obsidian/plugins/local-ir/data.json'), 'utf8'));
const results = [];
for (const entry of plan.documents.filter(d => d.reason === 'source_url_already_exists')) {
  const highlights = snapshot.highlight.filter(h => h.parent_id === entry.id), file = entry.existingPaths[0];
  const markdown = await fs.readFile(path.join(defaults.vault, file), 'utf8');
  const matches = highlights.map(h => ({ id: h.id, ...locateQuoteWithContext(markdown, h.content) }));
  results.push({ id: entry.id, path: file, status: settings.records[file]?.status, highlights: highlights.length,
    mapped: matches.filter(m => !m.issue).length, existingAnnotations: Object.values(settings.annotations).filter(a => a.path === file).length,
    issues: matches.filter(m => m.issue) });
}
await fs.writeFile(path.join(defaults.artifacts, 'duplicate-source-audit.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
