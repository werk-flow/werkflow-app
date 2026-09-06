// Local research bookkeeping only. This does not validate security advice or application code.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const inventoryPath = join(root, 'review-inventory.json');
const normalize = (value) => value.replaceAll('\r\n', '\n');
const read = (path) => normalize(readFileSync(path, 'utf8'));
const fingerprint = (value) => createHash('sha256').update(value).digest('hex');
const relativePath = (path) => relative(root, path).replaceAll('\\', '/');
const allFiles = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? allFiles(path) : [path];
});
const files = allFiles(root);
const isInbox = (path) => /(?:^|\/)(?:urls|mattmurphyai-urls|ai-graph-urls)\.txt$/.test(relativePath(path));
const reviewNames = new Set([
  'review-ai-model-news.md', 'review-commentary.md', 'review-engineering.md',
  'review-foundations.md', 'review-graph.md', 'review-product-growth.md',
  'review-security.md', 'review-terms.md', 'review-ui-ux.md',
]);
const sourceFiles = files.filter((path) => /\.(txt|md)$/.test(path) && !isInbox(path)
  && relativePath(path) !== 'README.md' && !reviewNames.has(relativePath(path)));
const reviewFiles = files.filter((path) => reviewNames.has(relativePath(path)));
const repositoryRoot = dirname(root);
const canonicalEvidenceExists = (consideration) => [...consideration.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].some((match) => {
  const target = match[1].replace(/[#?].*$/, '').replace(/:\d+$/, '');
  if (/^[a-z]+:\/\//i.test(target)) return false;
  const path = resolve(root, target);
  const repositoryPath = relative(repositoryRoot, path).replaceAll('\\', '/');
  const canonicalPath = /^(?:docs|app|components|hooks|lib|supabase|tests|scripts)\//.test(repositoryPath)
    || /^(?:AGENTS\.md|CLAUDE\.md|README\.md|package\.json|vercel\.json|next\.config\.(?:ts|js|mjs))$/.test(repositoryPath);
  return canonicalPath && existsSync(path);
});
const sources = new Map();
const seenPaths = new Set();
const problems = [];
const allowedStatuses = new Set(['Candidate', 'Deferred', 'Verify', 'Not applicable', 'Already covered']);

for (const reviewFile of reviewFiles) {
  const content = read(reviewFile);
  for (const section of content.split(/^## /m).slice(1)) {
    const id = section.split('\n')[0].trim();
    if (!/^[A-Z]+-\d{3}$/.test(id)) {
      problems.push(`Invalid source ID ${id} in ${relativePath(reviewFile)}`);
      continue;
    }
    const sourceMatch = section.match(/^Source: \[[^\]]+\]\(([^)]+)\)/m);
    const sourcePath = sourceMatch?.[1];
    if (!sourcePath) {
      problems.push(`Missing source link for ${id}`);
      continue;
    }
    const absolutePath = resolve(root, sourcePath);
    if (!sourceFiles.includes(absolutePath)) {
      problems.push(`Unknown source ${sourcePath} in ${id}`);
      continue;
    }
    if (sources.has(id) || seenPaths.has(sourcePath)) {
      problems.push(`Duplicate source ID or path: ${id} ${sourcePath}`);
      continue;
    }
    seenPaths.add(sourcePath);
    const aspects = section.split('\n').filter((line) => /^\| \d+ \|/.test(line)).map((line) => {
      const columns = line.split('|').slice(1, -1).map((column) => column.trim());
      if (columns.length !== 4) problems.push(`Expected four columns in ${id}: ${line}`);
      const [number, topic, status, consideration] = columns;
      if (!/^\d{2,}$/.test(number) || !topic || !consideration || !allowedStatuses.has(status)) {
        problems.push(`Invalid aspect ${id}.${number}`);
      }
      if (status === 'Already covered' && (!canonicalEvidenceExists(consideration)
        || !/\d{4}-\d{2}-\d{2}/.test(consideration) || !/Scope:\s*\S.+/i.test(consideration))) {
        problems.push(`${id}.${number} needs dated canonical evidence and stated scope`);
      }
      return { id: `${id}.${number}`, topic, status, consideration };
    });
    if (!aspects.length || new Set(aspects.map((aspect) => aspect.id)).size !== aspects.length) {
      problems.push(`Missing or duplicate aspect rows in ${id}`);
    }
    const source = read(absolutePath);
    sources.set(id, {
      id,
      source: sourcePath,
      sha256: fingerprint(source),
      lines: { start: 1, end: source.split('\n').length },
      reviewFile: relativePath(reviewFile),
      aspectIds: aspects.map((aspect) => aspect.id),
      aspects,
    });
  }
}

for (const path of sourceFiles) {
  if (!seenPaths.has(relativePath(path))) problems.push(`Unreviewed source: ${relativePath(path)}`);
}

const args = process.argv.slice(2);
let inventory = existsSync(inventoryPath) ? JSON.parse(read(inventoryPath)) : { version: 1, sources: [] };
if (args[0] === '--record') {
  const source = sources.get(args[1]);
  if (!source || args.length !== 2) throw new Error('Use --record with one reviewed source ID.');
  if (problems.some((problem) => !problem.startsWith('Unreviewed source:'))) throw new Error(problems.join('\n'));
  const previous = inventory.sources.find((entry) => entry.id === source.id);
  const removedIds = (previous?.aspectIds ?? []).filter((id) => !source.aspectIds.includes(id));
  if (removedIds.length) throw new Error(`Preserve retired aspects with a reason instead of deleting their IDs: ${removedIds.join(', ')}`);
  const record = { ...source };
  delete record.aspects;
  inventory.sources = inventory.sources.filter((entry) => entry.id !== source.id);
  inventory.sources.push({ ...record, reviewedOn: new Date().toISOString().slice(0, 10) });
  inventory.sources.sort((left, right) => left.id.localeCompare(right.id));
  writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2) + '\n');
  console.log(`Recorded reviewed source ${source.id}. Run the normal check for remaining sources.`);
  process.exit(0);
}

const recordedIds = new Set();
for (const record of inventory.sources) {
  if (recordedIds.has(record.id)) problems.push(`Duplicate inventory ID: ${record.id}`);
  recordedIds.add(record.id);
  const source = sources.get(record.id);
  if (!source) problems.push(`Orphaned inventory record: ${record.id}`);
  else if (record.source !== source.source || record.reviewFile !== source.reviewFile || record.sha256 !== source.sha256 || JSON.stringify(record.lines) !== JSON.stringify(source.lines)
    || JSON.stringify(record.aspectIds) !== JSON.stringify(source.aspectIds)) {
    problems.push(`Changed source or mapping requires review: ${record.id} ${record.source}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.reviewedOn ?? '')) problems.push(`Missing review date: ${record.id}`);
}
for (const id of sources.keys()) if (!recordedIds.has(id)) problems.push(`Reviewed source has no fingerprint: ${id}`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
if (args[0] === '--topic' && args.length === 2) {
  const query = args[1].toLowerCase();
  for (const source of sources.values()) {
    for (const aspect of source.aspects) {
      if (`${aspect.topic} ${aspect.consideration}`.toLowerCase().includes(query)) {
        console.log(`${aspect.id} | ${aspect.topic} | ${aspect.status} | ${aspect.consideration}\n  ${source.source} -> ${source.reviewFile}#${source.id.toLowerCase()}`);
      }
    }
  }
} else if (args.length) {
  throw new Error('Usage: check-inventory.mjs [--topic text | --record SOURCE-ID]');
}
const aspectCount = [...sources.values()].reduce((total, source) => total + source.aspects.length, 0);
console.log(`Inventory complete: ${sources.size} sources, ${aspectCount} aspects, ${files.filter(isInbox).length} URL inbox/history files excluded. Semantic completeness and missing video visuals require human review.`);
