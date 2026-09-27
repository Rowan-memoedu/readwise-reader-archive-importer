import fs from 'node:fs/promises';
import path from 'node:path';
import { defaults } from './audit.mjs';
const plan = JSON.parse(await fs.readFile(path.join(defaults.artifacts,'import-plan.json'),'utf8'));
const registry = JSON.parse(await fs.readFile(path.join(defaults.cache,'import-registry.json'),'utf8'));
const settings = JSON.parse(await fs.readFile(path.join(defaults.vault,'.obsidian/plugins/local-ir/data.json'),'utf8'));
const paths = new Set(Object.values(registry.documents).map(d=>d.markdownPath));
const readerAnnotations = Object.values(settings.annotations).filter(a=>paths.has(a.path)&&a.id.startsWith('readwise-'));
const held = plan.documents.filter(d=>d.action==='held');
const reasons = {highlights_missing_or_ambiguous:'Reader 正文无法对应全部高亮',binary_highlights_not_fully_located:'存在无法唯一定位的高亮',
  existing_source_highlights_not_fully_located:'已有本地正文无法对应全部 Reader 高亮',local_edits_or_document_move:'保留本地修改，暂不更新',
  source_url_already_exists:'来源 URL 已存在，暂不重复建档'};
const owned = Object.values(registry.documents).filter(d=>d.ownsMarkdown!==false).length;
const merged = Object.keys(registry.documents).length-owned;
let markdown = `# Reader Archive 导入结果\n\n更新：${new Date().toISOString()}\n\n`+
  `- 已新建 ${owned} 篇到待归档原文；${merged} 篇已有文章补入 Reader 高亮，原文和阅读状态保留。\n`+
  `- 本轮已有原文无需重复：${plan.documents.filter(d=>d.action==='already_present').length} 篇；暂缓：${held.length} 篇。\n`+
  `- 原生 Reader 高亮 ${readerAnnotations.length} 条，附带批注 ${readerAnnotations.filter(a=>a.commentMarkdown).length} 条。\n`+
  `- EPUB/PDF 为纯本地确定性转换，不调用大模型；没有文字层的 PDF 封面页保留整页图片。\n`+
  `- 后续运行 Obsidian 命令：**QuickAdd: Reader Archive → 待归档区**。\n\n## 暂缓清单\n\n`;
for(const doc of held) markdown+=`- [${doc.title||doc.id}](${doc.readerUrl})：${reasons[doc.reason]||doc.reason}。\n`;
markdown+='\n已删除的缺失 PDF 已排除。无法定位高亮时整篇暂缓；正文和高亮完整的 EPUB 源文件元数据/内链异常仅保留质量警告。\n';
const reportFolder=path.join(defaults.workflow,'imports','readwise-reader-archive-report'); await fs.mkdir(reportFolder,{recursive:true});
await fs.writeFile(path.join(reportFolder,'最新导入结果.md'),markdown);
await fs.writeFile(path.join(defaults.artifacts,'导入结果.md'),markdown);
console.log(`Readable report updated: ${owned} new documents, ${merged} merged, ${held.length} held`);
