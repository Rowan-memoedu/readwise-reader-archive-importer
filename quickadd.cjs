const { spawn } = require('child_process');
const fs = require('fs');
module.exports = async ({ obsidian, variables = {} }) => {
  const { Notice } = obsidian;
  if (globalThis.__readerArchiveQuickAddRunning) { new Notice('Reader Archive 导入正在运行。'); return; }
  globalThis.__readerArchiveQuickAddRunning = true;
  const folder = 'D:/Artifacts/ReadwiseReaderArchive'; fs.mkdirSync(folder, { recursive: true });
  const log = fs.createWriteStream(folder + '/quickadd-import.log', { flags: 'w' });
  new Notice('正在获取 Reader Archive 并导入待归档区。');
  try {
    const args = ['-NoLogo', '-NoProfile', '-File', 'D:/Projects/ReadwiseReaderArchiveImporter/Import.ps1'];
    if (variables.readerArchiveUseCache === true) args.push('-UseCache');
    await new Promise((resolve, reject) => {
      const child = spawn('C:/Users/fy/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe', args,
        { cwd: 'D:/Workspaces/新建文件夹', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', data => log.write(data)); child.stderr.on('data', data => log.write(data));
      child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error('导入进程退出码 ' + code)));
    });
    const plan = JSON.parse(fs.readFileSync(folder + '/import-plan.json', 'utf8'));
    const count = action => plan.documents.filter(d => d.action === action).length;
    new Notice(`Reader Archive 导入完成：新建 ${count('create')}，补充 ${count('update') + count('merge')}，暂缓 ${count('held')}。`, 12000);
  } catch (error) {
    new Notice('Reader Archive 导入失败；详情见 D:/Artifacts/ReadwiseReaderArchive/quickadd-import.log', 15000);
    throw error;
  } finally { log.end(); globalThis.__readerArchiveQuickAddRunning = false; }
};
