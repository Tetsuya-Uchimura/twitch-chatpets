import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
function check(directory) {
  for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
    const file=`${directory}/${entry.name}`;
    if(entry.isDirectory()){check(file);continue;}
    if(!/\.(?:js|mjs)$/.test(entry.name))continue;
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
for(const directory of ['src','scripts','tests'])check(directory);
console.log('All runtime, tooling and test JavaScript syntax checks passed.');
