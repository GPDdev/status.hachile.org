import { readFile, writeFile } from 'node:fs/promises';

// The Site repository owns these three sections. Keep the status dashboard and
// the rest of this page in this repository so a directory refresh cannot replace them.
const pagePath = new URL('../index.html', import.meta.url);
const sourcePath = process.argv[2];
if (!sourcePath) throw new Error('Usage: node scripts/sync-showcase.mjs <site-index.html>');
const source = await readFile(sourcePath, 'utf8');
let page = await readFile(pagePath, 'utf8');

function sectionRange(html, id) {
  let start = -1;
  let depth = 0;
  for (const tag of html.matchAll(/<\/?section\b[^>]*>/gi)) {
    if (start < 0) {
      if (!tag[0].includes(`id="${id}"`)) continue;
      start = tag.index;
    }
    depth += tag[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return [start, tag.index + tag[0].length];
  }
  throw new Error(`Missing or incomplete section #${id}`);
}

function statusDirectory(original) {
  const links = [...original.matchAll(/<a class="site-link" href="([^"]+)"/g)];
  if (!links.some(link => link[1] === 'https://status.hachile.org/')) {
    throw new Error('The public Site directory does not yet list Hachile Status');
  }
  let directory = original;
  if (!links.some(link => link[1] === 'https://site.hachile.org/')) {
    const entry = '          <li><a class="site-link" href="https://site.hachile.org/"><span class="site-name">The Hachile Project<span class="site-arrow" aria-hidden="true">↗</span></span><span class="site-description">浏览站群目录、阅读 Hachile 的宗旨，查阅历次更新。</span><span class="site-domain">site.hachile.org</span></a></li>';
    const [start, end] = sectionRange(directory, 'branch-work');
    const branch = directory.slice(start, end);
    if (!branch.includes('</ul>')) throw new Error('Missing project list');
    directory = directory.slice(0, start) + branch.replace(/^[ \t]*<\/ul>/m, match => entry + '\n' + match) + directory.slice(end);
  }
  const count = [...directory.matchAll(/<a class="site-link" href="/g)].length;
  return directory.replace(/\d+ 个站点，/, `${count} 个站点，`)
    .replace(/<p class="directory-note">[\s\S]*?<\/p>/, '<p class="directory-note">站群目录同步自 <a href="https://site.hachile.org/">site.hachile.org</a>。</p>');
}

for (const id of ['directory', 'purpose', 'changelog']) {
  const [start, end] = sectionRange(page, id);
  const original = source.slice(...sectionRange(source, id));
  page = page.slice(0, start) + (id === 'directory' ? statusDirectory(original) : original) + page.slice(end);
}
await writeFile(pagePath, page);
