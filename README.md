# Readwise Reader Archive 导入

将 Reader Archive 的原文、高亮、批注与全文随想导入既有 Obsidian Local IR 的待归档区。

复用 Readwise Official 的本地账号凭据、官方 Reader API 与现有 Local IR 文档格式。后续手动补导；来源数据和本地修改保持可恢复。

所有账号凭据、来源正文、运行状态和验收数据只保存在本机 D 盘，禁止提交到 Git。

## 当前交付阶段：EPUB/PDF 导入前验收

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

运行前置：已获取完整 Archive/highlight/note 快照及 binary-source-index，原始文件缓存位于 `D:\AppData\ReadwiseReaderArchive`。本阶段不包含正式发布或未来手动补导入口；它们仍是主任务待完成项。

PDF 转换保留文字和图像，但不会重建原版分页排版。EPUB 源文件缺少元数据、无效内部链接、重复锚点都会留在质量报告中。
