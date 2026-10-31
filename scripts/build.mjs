import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist', 'public');
// Rebuild only this project's output; never retain files from retired experiments.
await fs.mkdir(path.dirname(output), { recursive: true });
const realRoot = await fs.realpath(root), realDist = await fs.realpath(path.dirname(output));
if (path.dirname(realDist) !== realRoot || path.basename(realDist) !== 'dist') throw new Error('Build directory must stay inside the project.');
try {
  const realOutput = await fs.realpath(output);
  if (path.dirname(realOutput) !== realDist || path.basename(realOutput) !== 'public') throw new Error('Unexpected build output target.');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });
await build({ absWorkingDir: root, entryPoints: { app: 'src/client/app.js', style: 'src/client/style.css' },
  outdir: output, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, sourcemap: false });
const html = (await fs.readFile(path.join(root, 'src', 'client', 'index.html'), 'utf8'))
  .replace('/style.css?v=nib-metamorph-v2', '/style.css')
  .replace('/app.js?v=nib-metamorph-v2', '/app.js');
await fs.writeFile(path.join(output, 'index.html'), html);
await fs.mkdir(path.join(output, 'nib-lab'), { recursive: true });
for (const file of ['index.html', 'lab.css', 'evolve.html', 'evolve.css', 'comparison.png', 'evolution.webm']) {
  await fs.copyFile(path.join(root, 'src', 'client', 'nib-lab', file), path.join(output, 'nib-lab', file));
}
await build({absWorkingDir:root,entryPoints:['src/client/nib-lab/lab.js'],outfile:path.join(output,'nib-lab','lab.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true});
await build({absWorkingDir:root,entryPoints:['src/client/nib-lab/evolve.js'],outfile:path.join(output,'nib-lab','evolve.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true});
console.log('Built Nib dashboard, OBS overlay and current form/evolution previews in dist/public. Secrets and runtime data are excluded.');
