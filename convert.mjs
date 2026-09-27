import { createRequire } from 'node:module';
import crypto from 'node:crypto';

export function loadDependencies(workflow) {
  const require = createRequire(`${workflow.replaceAll('\\', '/')}/package.json`);
  return { JSDOM: require('jsdom').JSDOM, VirtualConsole: require('jsdom').VirtualConsole, Turndown: require('turndown'), gfm: require('turndown-plugin-gfm').gfm };
}
export const sha = value => crypto.createHash('sha256').update(value).digest('hex');
export function canonicalUrl(value) {
  try { const u = new URL(value); u.hash = ''; u.hostname = u.hostname.toLowerCase();
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
    u.searchParams.sort(); return u.href.replace(/\/$/, '');
  } catch { return ''; }
}
export function projection(text, ignoreMarkdown = false) {
  let value = ''; const starts = [], ends = [];
  const hidden = [];
  if (ignoreMarkdown) {
    for (const match of text.matchAll(/!\[[^\n]*?\]\((?:\\.|[^)])*\)/g)) hidden.push({ start: match.index, end: match.index + match[0].length });
    for (const match of text.matchAll(/\]\((?:\\.|[^)])*\)/g)) hidden.push({ start: match.index + 1, end: match.index + match[0].length });
    for (const match of text.matchAll(/!?\[([^\n]*?)\]\((?:\\.|[^)])*\)/g)) {
      const opening = match.index + (match[0].startsWith('!') ? 1 : 0);
      hidden.push({ start: opening, end: opening + 1 });
      const closing = match.index + match[0].indexOf('](');
      hidden.push({ start: closing, end: closing + 1 });
    }
    for (const match of text.matchAll(/^ {0,3}(?:[-+*]|\d+[.)]|#{1,6}|>)\s+/gm)) hidden.push({ start: match.index, end: match.index + match[0].length });
    for (const match of text.matchAll(/<!--[^]*?-->|<\/?[A-Za-z][^>]*>|\[\^[^\]]+\]/g)) hidden.push({ start: match.index, end: match.index + match[0].length });
  }
  hidden.sort((a, b) => a.start - b.start); let hiddenIndex = 0;
  for (let i = 0; i < text.length;) {
    const c = String.fromCodePoint(text.codePointAt(i)); const start = i; i += c.length;
    while (hiddenIndex < hidden.length && hidden[hiddenIndex].end <= start) hiddenIndex++;
    if (hidden[hiddenIndex] && start >= hidden[hiddenIndex].start && start < hidden[hiddenIndex].end) continue;
    for (let n of c.normalize('NFKC')) {
      if (ignoreMarkdown) n = n.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
      if (/[\s\u00ad\u200b-\u200f\ufeff]/u.test(n) || (ignoreMarkdown && /[*_`\\]/u.test(n))) continue;
      value += n; for (let k = 0; k < n.length; k++) { starts.push(start); ends.push(i); }
    }
  }
  return { value, starts, ends };
}
function matches(haystack, needle) {
  const result = []; if (!needle) return result;
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) result.push(at);
  return result;
}
export function locateQuote(text, quote, offset = null, ignoreMarkdown = false) {
  const p = projection(text, ignoreMarkdown), q = projection(quote, ignoreMarkdown).value;
  const hits = matches(p.value, q);
  let at = hits.length === 1 ? hits[0] : hits.find(i => Number.isInteger(offset) && p.starts[i] === offset);
  if (at === undefined) return { issue: hits.length ? 'ambiguous_highlight' : 'highlight_not_in_source' };
  return { start: p.starts[at], end: p.ends[at + q.length - 1] };
}
export function locateQuoteWithContext(text, quote, context = {}) {
  const p = projection(text, true), q = projection(quote, true).value;
  const hits = matches(p.value, q);
  if (hits.length === 1) return { start: p.starts[hits[0]], end: p.ends[hits[0] + q.length - 1] };
  const before = projection(context.contextBefore || '', true).value;
  const after = projection(context.contextAfter || '', true).value;
  for (const length of [60, 40, 20]) {
    const b = before.slice(-length), a = after.slice(0, length);
    if (b.length < 20 && a.length < 20) continue;
    const beforeHits = b.length >= 20 ? hits.filter(i => p.value.slice(Math.max(0, i - b.length), i) === b) : [];
    const afterHits = a.length >= 20 ? hits.filter(i => p.value.slice(i + q.length, i + q.length + a.length) === a) : [];
    const candidates = [...new Set([...(beforeHits.length === 1 ? beforeHits : []), ...(afterHits.length === 1 ? afterHits : [])])];
    if (candidates.length === 1) return { start: p.starts[candidates[0]], end: p.ends[candidates[0] + q.length - 1] };
  }
  return { issue: hits.length ? 'ambiguous_highlight' : 'highlight_not_in_source' };
}
function makeTurndown(deps) {
  const td = new deps.Turndown({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  td.use(deps.gfm); td.keep(['sup', 'sub', 'math']);
  td.addRule('mathTex', { filter: n => n.nodeName === 'SCRIPT' && /^math\/tex/.test(n.getAttribute('type') || ''),
    replacement: (_, n) => /mode=display/.test(n.getAttribute('type') || '') ? `\n\n$$\n${n.textContent}\n$$\n\n` : `$${n.textContent}$` });
  return td;
}
export function noteText(raw, deps) {
  const text = String(raw || '');
  return /<(?:p|div|br|ul|ol|li|strong|em|span|a)\b/i.test(text) ? makeTurndown(deps).turndown(text) : text;
}
export function combineNotes(values) {
  const seen = new Set(), result = [];
  for (const value of values) { const key = projection(String(value)).value;
    if (key && !seen.has(key)) { seen.add(key); result.push(String(value)); }
  } return result.join('\n\n');
}
function rangeFromSerialized(document, location, quote) {
  if (!location || !location.includes(',')) return null;
  const points = location.split(',').map(s => { const k = s.lastIndexOf(':');
    return { indices: s.slice(0, k).split('/').map(Number), offset: Number(s.slice(k + 1)) }; });
  if (points.length !== 2) return null;
  for (const root of [document.body, document.body.firstElementChild, document.documentElement]) {
    for (const elementsOnly of [false, true]) {
      for (const reversePath of [true, false]) for (const characterOffsets of [true, false]) {
        try { const locate = p => {
          const indices = reversePath ? [...p.indices].reverse() : p.indices;
          const node = indices.reduce((n, index) => (elementsOnly ? n.children : n.childNodes)[index], root);
          if (!characterOffsets || node.nodeType === 3) return { node, offset: p.offset };
          const walker = document.createTreeWalker(node, 4); let offset = p.offset;
          for (let text = walker.nextNode(); text; text = walker.nextNode()) {
            if (offset <= text.data.length) return { node: text, offset }; offset -= text.data.length;
          }
          throw Error('Character offset outside node');
        };
          const start = locate(points[0]), end = locate(points[1]);
          const range = document.createRange(); range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset);
          if (quote ? projection(range.toString()).value === projection(quote).value : range.cloneContents().querySelector('img')) return range;
        } catch { /* Try the other serialized-root and offset convention. */ }
      }
    }
  } return null;
}
export function convertHtml(doc, highlights, notes, deps) {
  if (!String(doc.html_content || '').trim()) return { issues: [{ kind: 'source_html_unavailable', id: doc.id }] };
  const dom = new deps.JSDOM(doc.html_content, { virtualConsole: new deps.VirtualConsole() }), document = dom.window.document;
  const nodes = []; let source = '';
  const walker = document.createTreeWalker(document.body, 4);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest('style,script:not([type^="math/tex"]),head')) continue;
    nodes.push({ node, start: source.length, end: source.length + node.data.length }); source += node.data;
  }
  const additions = new Map(), anchored = [], issues = [];
  const point = (absolute, isEnd) => {
    const n = nodes.find(n => isEnd ? absolute > n.start && absolute <= n.end : absolute >= n.start && absolute < n.end);
    return n && { node: n.node, offset: absolute - n.start };
  };
  const add = (node, offset, text) => { if (!additions.has(node)) additions.set(node, []); additions.get(node).push({ offset, text }); };
  highlights.forEach((h, index) => {
    const quote = String(h.content || ''); let location = locateQuote(source, quote, h.highlight_offset);
    let start, end;
    const serialized = rangeFromSerialized(document, h.highlight_location, quote);
    if (serialized && !quote && serialized.cloneContents().querySelector('img')) {
      start = { node: serialized.startContainer, offset: serialized.startOffset };
      end = { node: serialized.endContainer, offset: serialized.endOffset };
    } else if (serialized) {
      const positions = new Map(nodes.map(n => [n.node, n.start]));
      if (positions.has(serialized.startContainer) && positions.has(serialized.endContainer)) {
        location = { start: positions.get(serialized.startContainer) + serialized.startOffset,
          end: positions.get(serialized.endContainer) + serialized.endOffset };
      }
    }
    if (!start && !location.issue) { start = point(location.start, false); end = point(location.end, true); }
    if (!start || !end) { issues.push({ kind: location.issue || 'invalid_highlight_boundary', id: h.id }); return; }
    const key = `RW${index}`; add(start.node, start.offset, `\uE000${key}S\uE001`); add(end.node, end.offset, `\uE000${key}E\uE001`);
    anchored.push({ h, key });
  });
  for (const [node, items] of additions) for (const item of items.sort((a, b) => b.offset - a.offset)) {
    if (node.nodeType === 3) node.insertData(item.offset, item.text);
    else node.insertBefore(document.createTextNode(item.text), node.childNodes[item.offset] || null);
  }
  const marked = makeTurndown(deps).turndown(document.body.innerHTML), positions = new Map();
  let body = '', cursor = 0;
  for (const m of marked.matchAll(/\uE000(RW\d+)([SE])\uE001/g)) {
    body += marked.slice(cursor, m.index); positions.set(m[1] + m[2], body.length); cursor = m.index + m[0].length;
  }
  body += marked.slice(cursor); body += '\n';
  const annotations = anchored.map(({ h, key }) => {
    const start = positions.get(key + 'S'), end = positions.get(key + 'E');
    if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) { issues.push({ kind: 'conversion_lost_highlight_marker', id: h.id }); return null; }
    const commentMarkdown = combineNotes([noteText(h.notes, deps), ...notes.filter(n => n.parent_id === h.id).map(n => noteText(n.content, deps))]);
    return { id: `readwise-${h.id}`, selectedText: body.slice(start, end), originalText: body.slice(start, end), currentText: body.slice(start, end),
      protectedKind: h.content ? null : 'image',
      type: commentMarkdown ? 'comment' : 'highlight', commentMarkdown, sourceFormat: 'virtual', renderMode: 'virtual_decoration',
      markKind: 'highlight', virtualRanges: [{ start, end }], range: { start, end }, sourceOffset: start,
      contextBefore: body.slice(Math.max(0, start - 80), start), contextAfter: body.slice(end, end + 80),
      fragments: [{ index: 0, text: body.slice(start, end), sourceRange: { start, end },
        contextBefore: body.slice(Math.max(0, start - 80), start), contextAfter: body.slice(end, end + 80) }],
      createdAt: h.created_at, updatedAt: h.updated_at, archived: false, orphaned: false,
      readwise: { id: h.id, originalQuote: h.content, location: h.highlight_location, offset: h.highlight_offset, noteIds: notes.filter(n => n.parent_id === h.id).map(n => n.id), tags: h.tags } };
  }).filter(Boolean);
  const articleNotes = combineNotes([noteText(doc.notes, deps), ...notes.filter(n => n.parent_id === doc.id).map(n => noteText(n.content, deps))]);
  const articleMusing = articleNotes ? { id: `readwise-musing-${doc.id}`, bodyMarkdown: articleNotes,
    aiStatus: 'skipped', createdAt: doc.created_at, updatedAt: doc.updated_at, archived: false } : null;
  if (body.includes('\uE000') || body.includes('\uE001')) issues.push({ kind: 'unresolved_marker', id: doc.id });
  dom.window.close(); return { body, annotations, articleMusing, issues };
}
