import fs from 'node:fs/promises';
import path from 'node:path';
import { defaults } from './audit.mjs';

const settings = JSON.parse((await fs.readFile(path.join(defaults.vault, '.obsidian/plugins/readwise-official/data.json'), 'utf8')).replace(/^\uFEFF/, ''));
if (!settings.token) throw Error('Readwise Official is not connected');
const incoming = path.join(defaults.cache, 'incoming');
await fs.mkdir(incoming, { recursive: true });
const names = [], archive = [];
for (const category of ['archive', 'highlight', 'note']) {
  let cursor = '', page = 0, count = null; const ids = new Set();
  do {
    const url = new URL('https://readwise.io/api/v3/list/');
    url.searchParams.set('limit', '100');
    if (category === 'archive') { url.searchParams.set('location', 'archive'); url.searchParams.set('withHtmlContent', 'true'); url.searchParams.set('withRawSourceUrl', 'true'); }
    else url.searchParams.set('category', category);
    if (cursor) url.searchParams.set('pageCursor', cursor);
    let response;
    for (let attempt = 0; attempt < 8; attempt++) {
      response = await fetch(url, { headers: { Authorization: 'Token ' + settings.token }, redirect: 'error', signal: AbortSignal.timeout(60000) });
      if (response.status !== 429) break;
      console.log('Reader rate limit; waiting 60 seconds'); await new Promise(resolve => setTimeout(resolve, 60000));
    }
    if (!response.ok) throw Error(`Reader HTTP ${response.status}`);
    const data = await response.json();
    if (count === null) count = data.count;
    if (data.count !== count && data.count !== count - ids.size) throw Error(`Reader ${category} changed during pagination; retry later`);
    for (const doc of data.results) { if (ids.has(doc.id)) throw Error('Duplicate Reader cursor item'); ids.add(doc.id); }
    if (category === 'archive') archive.push(...data.results);
    const name = `${category}-page-${++page}.json`;
    await fs.writeFile(path.join(incoming, name), JSON.stringify(data)); names.push(name);
    console.log(`Fetched ${category} page ${page}: ${data.results.length} items`);
    cursor = data.nextPageCursor || '';
  } while (cursor);
  if (ids.size !== count) throw Error(`Incomplete ${category} snapshot`);
}
await fs.writeFile(path.join(incoming, 'binary-source-index.json'), JSON.stringify(archive.filter(d => ['epub', 'pdf'].includes(d.category))));
names.push('binary-source-index.json');
const backup = `D:/Quarantine/ReadwiseReaderArchive/Snapshots/${Date.now()}`;
await fs.mkdir(backup, { recursive: true });
for (const name of await fs.readdir(defaults.cache)) {
  if (!/^(?:archive|highlight|note)-page-\d+\.json$|^binary-source-index\.json$/.test(name)) continue;
  const source = path.resolve(defaults.cache, name);
  if (!source.startsWith(path.resolve(defaults.cache) + path.sep)) throw Error('Invalid snapshot path');
  await fs.rename(source, path.join(backup, name));
}
for (const name of names) await fs.rename(path.join(incoming, name), path.join(defaults.cache, name));
console.log(`Reader Archive snapshot committed: ${archive.length} documents`);
