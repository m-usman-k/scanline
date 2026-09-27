// Static checks for the extension (no dependencies): manifest sanity, referenced files exist,
// every module parses, and no module has unused named imports.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repo = path.resolve(import.meta.dirname, '..');
const root = path.join(repo, 'src'); // the extension itself
const rel = (p) => path.join(root, p);
const problems = [];

const manifest = JSON.parse(fs.readFileSync(rel('manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) problems.push('manifest_version must be 3');
if ((manifest.description || '').length > 132) problems.push(`description is ${manifest.description.length} chars (max 132)`);
const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
if (pkg.version !== manifest.version) problems.push(`package.json version ${pkg.version} != manifest ${manifest.version}`);

const referenced = [
  manifest.background.service_worker,
  manifest.action.default_popup,
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),
  'content/collector.js',
  'pages/report/report.html',
];
for (const f of referenced) if (!fs.existsSync(rel(f))) problems.push(`missing file: ${f}`);

for (const html of ['pages/popup/popup.html', 'pages/report/report.html']) {
  const src = fs.readFileSync(rel(html), 'utf8');
  for (const [, ref] of src.matchAll(/(?:src|href)="([^"#:]+)"/g)) if (!fs.existsSync(path.join(path.dirname(rel(html)), ref))) problems.push(`${html} references missing ${ref}`);
  if (/\son[a-z]+=/i.test(src)) problems.push(`${html} has inline event handlers (blocked by the extension CSP)`);
}

const jsFiles = ['background.js', 'pages/popup/popup.js', 'pages/report/report.js', 'content/collector.js', ...fs.readdirSync(rel('lib')).map((f) => `lib/${f}`)];
for (const f of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', rel(f)], { stdio: 'pipe' });
  } catch (e) {
    problems.push(`syntax error in ${f}: ${String(e.stderr).split('\n').slice(0, 4).join(' ')}`);
  }
  const src = fs.readFileSync(rel(f), 'utf8');
  const body = src.replace(/import\s*\{[^}]+\}\s*from\s*['"][^'"]+['"];?/g, '');
  for (const [, list] of src.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    for (const spec of list.split(',').map((s) => s.trim()).filter(Boolean)) {
      const name = spec.split(/\s+as\s+/).pop();
      const re = new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`);
      if (!re.test(body)) problems.push(`${f}: unused import ${name}`);
    }
  }
}

if (problems.length) {
  console.error(`✗ ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`✓ manifest, ${referenced.length} referenced files and ${jsFiles.length} scripts look good`);
