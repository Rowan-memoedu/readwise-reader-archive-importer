# Readwise Reader Archive 导入

将 Reader Archive 的原文、高亮、批注与全文随想导入既有 Obsidian Local IR 的待归档区。

复用 Readwise Official 的本地账号凭据、官方 Reader API 与现有 Local IR 文档格式。后续手动补导；来源数据和本地修改保持可恢复。

所有账号凭据、来源正文、运行状态和验收数据只保存在本机 D 盘，禁止提交到 Git。

## 手动导入入口

Obsidian 命令面板运行 **QuickAdd: Reader Archive → 待归档区**。现有 QuickAdd 宏调用本仓库 `quickadd.cjs`，弹出开始/结束提示；运行窗口保持隐藏，不配置自动同步。

也可双击 `导入ReaderArchive.cmd`，或运行：

```powershell
pwsh -NoLogo -NoProfile -File 'D:\Projects\ReadwiseReaderArchiveImporter\Import.ps1'
```

完整入口重新获取官方 Reader API 的 Archive 原文及高亮/批注，转换 EPUB/PDF，生成计划，再通过正在运行的 Obsidian 原生 CLI 和 Local IR 方法导入。正文进入 `04 Projects/渐进阅读工作流/待归档原文`，原生状态位于 `.local-ir/browser-document-state`，电子书图片进入 `附件/Readwise`。

来源 URL 全局去重；已有文件正文及阅读状态保留，只在全部高亮可以准确定位时合并 Reader 标注。导入器拥有的旧文件只有在正文和原生状态都未被本地修改时才可更新。无法定位高亮则整篇暂缓；不删除 Reader 已移走内容的本地笔记。

正式流程已验证：103 篇新建、1 篇已有文章补入 6 条 Reader 高亮、1 篇已有原文无需重复；另外 7 篇按标准暂缓。重新获取 Reader 全量数据并再次运行入口可跳过已导入条目。标题高亮由 Reader 原始 title 字段恢复，未改写正文。

`import-plan.json` 是本轮计划与暂缓原因；`independent-import-verification.json` 是独立落盘核对；QuickAdd 日志为 `quickadd-import.log`。这些文件都在 `D:\Artifacts\ReadwiseReaderArchive`。每轮还会自动生成易读的 `导入结果.md`，Obsidian 内的副本为 `imports/readwise-reader-archive-report/最新导入结果.md`。

## EPUB/PDF 隔离验收

`Validate.ps1` 是只读来源、隔离输出的自动验证入口。它不会向正式待归档区写入，也不会改动 Local IR 的正式设置。

1. 从本地 Reader 官方 API 快照取得原始 EPUB/PDF（下载链接缺失或过期会失败并保留）。
2. EPUB 复用既有 `rich-text-import` 的全 spine 转换，校验章节、图片、内链与原文件哈希。
3. PDF 使用 pdfplumber 逐页提取文字层；无文字层的页面以 pypdfium2 渲染为完整页图片。保留已有转换器提取的嵌入图片，不做 OCR、LLM 或 MinerU 调用。
4. 将 Reader 高亮和批注映射到 Markdown 精确范围。歧义不会猜测。全文随想进入 native articleMusing，AI 状态为 skipped。
5. 调用真实 Local IR 插件源码的导入方法，在隔离宿主中验证位置、数量、批注和第二次导入的幂等性。

```powershell
pwsh -NoLogo -NoProfile -File 'D:\Projects\ReadwiseReaderArchiveImporter\Validate.ps1'
```

报告：`D:\Artifacts\ReadwiseReaderArchive\binary-import-audit.json`。`acceptance=passed` 只表示隔离转换和导入验收通过，不代表已正式导入。`held` 文件保留原因，不能当作成功。

运行前置：已获取完整 Archive/highlight/note 快照及 binary-source-index，原始文件缓存位于 `D:\AppData\ReadwiseReaderArchive`。正式流程使用上面的 Import.ps1，Validate.ps1 始终只做隔离验证。

PDF 转换保留文字和图像，但不会重建原版分页排版。EPUB 源文件缺少元数据、无效内部链接、重复锚点都会留在质量报告中。

账号令牌只从 Readwise Official 配置读取；个人例外及已确定导入标准保存在 `D:\AppData\ReadwiseReaderArchive\policy.json`，不进入 Git。仓库中的 policy.example.json 只是格式示例。原始文件、正文、资产、运行记录、签名下载链接和备份均不进入 Git。

QuickAdd 用户脚本能力参考：[官方文档](https://quickadd.obsidian.guide/docs/UserScripts/)。
