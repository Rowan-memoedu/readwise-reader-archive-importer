(async () => {
  const fs = require("fs"), path = require("path"), crypto = require("crypto");
  const artifacts = "D:/Artifacts/ReadwiseReaderArchive", cache = "D:/AppData/ReadwiseReaderArchive";
  const plan = JSON.parse(fs.readFileSync(artifacts + "/import-plan.json", "utf8"));
  const plugin = app.plugins.plugins["local-ir"];
  if (!plugin) throw Error("Local IR is not loaded");
  const hash = value => crypto.createHash("sha256").update(value).digest("hex");
  const base = app.vault.adapter.getBasePath();
  const absolute = relative => {
    const target = path.resolve(base, relative);
    if (!target.toLowerCase().startsWith((path.resolve(base) + path.sep).toLowerCase())) throw Error("Target outside vault");
    return target;
  };
  const receipt = { startedAt: new Date().toISOString(), documents: [] };
  fs.writeFileSync(artifacts + "/native-import-result.json", JSON.stringify(receipt, null, 2));
  // Persist live user edits before checking whether an importer-owned file may
  // be refreshed. Never edit data.json directly.
  await plugin.flushDocumentStateSidecars();
  const selected = plan.documents.filter(d => ["create", "update", "merge"].includes(d.action));
  for (const entry of plan.limit ? selected.slice(0, plan.limit) : selected) {
    const markdown = fs.readFileSync(entry.stagedMarkdown, "utf8");
    const state = JSON.parse(fs.readFileSync(entry.stagedState, "utf8"));
    const mdAbsolute = absolute(entry.markdownPath), sidecarAbsolute = absolute(entry.sidecarPath);
    if (entry.action === "create" && (fs.existsSync(mdAbsolute) || fs.existsSync(sidecarAbsolute))) throw Error("Creation target already exists: " + entry.id);
    if (entry.action === "update") {
      if (hash(fs.readFileSync(mdAbsolute)) !== entry.expectedMarkdownSha256 || hash(fs.readFileSync(sidecarAbsolute)) !== entry.expectedSidecarSha256) throw Error("Local edits protected: " + entry.id);
      const backup = "D:/Quarantine/ReadwiseReaderArchive/" + Date.now() + "/" + entry.id;
      fs.mkdirSync(backup, { recursive: true });
      fs.copyFileSync(mdAbsolute, backup + "/original.md"); fs.copyFileSync(sidecarAbsolute, backup + "/original.browser-ir.json");
    }
    if (entry.action === "merge") {
      const collections = { annotations: Object.values(plugin.settings.annotations).filter(a=>a.path===entry.markdownPath).sort((a,b)=>a.id.localeCompare(b.id)),
        qaCards: Object.values(plugin.settings.qaCards).filter(a=>a.path===entry.markdownPath).sort((a,b)=>a.id.localeCompare(b.id)), articleMusing: plugin.settings.articleMusings[entry.markdownPath] || null };
      if (hash(fs.readFileSync(mdAbsolute)) !== entry.expectedMarkdownSha256 || hash(JSON.stringify(collections)) !== entry.expectedCollectionsSha256) throw Error("Existing document edits protected");
      const backup = "D:/Quarantine/ReadwiseReaderArchive/" + Date.now() + "/" + entry.id;
      fs.mkdirSync(backup,{recursive:true}); fs.writeFileSync(backup+"/collections.json",JSON.stringify(collections,null,2));
      if (fs.existsSync(sidecarAbsolute)) fs.copyFileSync(sidecarAbsolute,backup+"/original.browser-ir.json");
    }
    for (const annotation of state.annotations) if (plugin.settings.annotations[annotation.id] && plugin.settings.annotations[annotation.id].path !== entry.markdownPath) throw Error("Existing annotation identity conflict");
    for (const asset of entry.assets || []) {
      const bytes = fs.readFileSync(asset.source);
      if (hash(bytes) !== asset.sha256) throw Error("Staged asset changed");
      const target = absolute(asset.target);
      if (fs.existsSync(target)) { if (hash(fs.readFileSync(target)) !== asset.sha256) throw Error("Existing asset protected"); }
      else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes); }
    }
    await plugin.ensureFolder(entry.markdownPath.split("/").slice(0,-1).join("/"));
    let file = app.vault.getAbstractFileByPath(entry.markdownPath);
    if (entry.action === "create") file = await app.vault.create(entry.markdownPath, markdown);
    else if (entry.action === "merge" && file) { /* Preserve existing original byte for byte. */ }
    else if (file) await app.vault.modify(file, markdown);
    else throw Error("Import-owned file was moved");
    await plugin.ensureFolder(entry.sidecarPath.split("/").slice(0,-1).join("/"));
    await app.vault.adapter.write(entry.sidecarPath, JSON.stringify(state, null, 2));
    if (!plugin.settings.records[entry.markdownPath]) plugin.settings.records[entry.markdownPath] = await plugin.createRecord(file);
    await plugin.importDocumentStateSidecarPath(entry.markdownPath, entry.sidecarPath, markdown);
    const record = plugin.settings.records[entry.markdownPath];
    if (record.status !== (entry.expectedStatus || "done") || (entry.action !== "merge" && record.completedSourcePath !== entry.markdownPath)) throw Error("Document status mismatch");
    const actual = Object.values(plugin.settings.annotations).filter(a => a.path === entry.markdownPath);
    if (actual.length !== state.annotations.length) throw Error("Imported annotation count mismatch");
    for (const expected of state.annotations) {
      const value = plugin.settings.annotations[expected.id];
      if (!value || value.orphaned || value.range.start !== expected.range.start || value.range.end !== expected.range.end || value.commentMarkdown !== expected.commentMarkdown) throw Error("Imported annotation content/location mismatch");
    }
    if ((plugin.settings.articleMusings[entry.markdownPath]?.bodyMarkdown || "") !== (state.articleMusing?.bodyMarkdown || "")) throw Error("Full musing mismatch");
    await plugin.saveSettings();
    receipt.documents.push({ id: entry.id, path: entry.markdownPath, annotations: actual.length, comments: actual.filter(a => a.commentMarkdown).length,
      musing: Boolean(state.articleMusing), revision: record.documentStateRevision, passed: true });
    fs.writeFileSync(artifacts + "/native-import-result.json", JSON.stringify(receipt, null, 2));
  }
  receipt.completedAt = new Date().toISOString();
  fs.writeFileSync(artifacts + "/native-import-result.json", JSON.stringify(receipt, null, 2));
  await plugin.refreshViews();
  return JSON.stringify({ imported: receipt.documents.length, annotations: receipt.documents.reduce((n, d) => n + d.annotations, 0), passed: true });
})()
