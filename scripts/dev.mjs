import { spawn } from 'node:child_process';
import { initEnv } from './init.mjs';
initEnv();
const children = [
  spawn(process.execPath, ['--watch', 'scripts/start.mjs'], { stdio: 'inherit', windowsHide: true }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit', windowsHide: true }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const child of children) { child.on('exit', code => stop(code || 0)); child.on('error', error => { console.error(error.message); stop(1); }); }
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
