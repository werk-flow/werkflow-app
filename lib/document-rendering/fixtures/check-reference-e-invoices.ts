// The reference invoices of the invoice core (lib/invoicing/fixtures/), rendered as ZUGFeRD PDFs
// by the one renderer, checked by the two reference checkers the app cannot run itself (no Java at
// run time): Mustang validates each PDF with its embedded EN 16931 XML, veraPDF checks PDF/A-3b; two
// of them carry an image stationery and a non-PDF/A stationery PDF. The same run proves the checkers
// refuse a broken copy: XML changed after embedding (Mustang) and a missing output intent (veraPDF).
// Tool versions are pinned; Mustang's jar is checked against its SHA-256 and each image is pulled by
// digest. CI's `E-invoices` job runs it when the plan selects it
// (lib/testing/selection/e-invoice-selection.ts); it needs Docker and the network.
// Usage: bun lib/document-rendering/fixtures/check-reference-e-invoices.ts <empty output directory>
// The directory keeps the checked PDFs and Mustang's reports. Exits 0 when every check holds.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';

const MUSTANG_VERSION = '2.26.0';
const MUSTANG_SHA256 = '42d7868cb68264874a7b8cab4c3587b03b23ccc7cd72373da917f66758bb9736';
const JAVA_IMAGE =
  'eclipse-temurin:21.0.13_9-jre-noble@sha256:0d57a8e90c2bb844c5a8e1b2b71e11eff06dad7edcfd803cd21ed4ae203b2515';
const VERAPDF_IMAGE =
  'verapdf/cli:v1.30.3@sha256:d74b7026c18a0f171e73c153b617fe6520e1511feb24ca98a348b2bb897669fb';

const repository = resolve(import.meta.dir, '../../..');
const argument = process.argv[2];
if (!argument) throw new Error('Usage: check-reference-e-invoices.ts <empty output directory>');
const pdfs = resolve(argument);
mkdirSync(pdfs, { recursive: true });
// A file of an earlier run would be checked as if this run had rendered it.
if (readdirSync(pdfs).length) throw new Error(`${pdfs} is not empty.`);

/** Runs a command with its output shown, and returns its exit code. */
function run(command: string, args: readonly string[]): number {
  return spawnSync(command, args, { cwd: repository, stdio: 'inherit' }).status ?? 1;
}

/** Runs a command and returns its exit code and its output, stdout and stderr together. */
function capture(command: string, args: readonly string[]): { status: number; output: string } {
  const result = spawnSync(command, args, { cwd: repository, encoding: 'utf8' });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** Mustang's jar in a cache outside the checkout, downloaded when it is missing or its checksum differs. */
async function mustangJar(): Promise<string> {
  const folder = join(repository, 'node_modules/.cache/mustang');
  const jar = join(folder, `Mustang-CLI-${MUSTANG_VERSION}.jar`);
  if (existsSync(jar) && createHash('sha256').update(readFileSync(jar)).digest('hex') === MUSTANG_SHA256)
    return jar;
  const response = await fetch(
    `https://repo1.maven.org/maven2/org/mustangproject/Mustang-CLI/${MUSTANG_VERSION}/Mustang-CLI-${MUSTANG_VERSION}.jar`,
  );
  if (!response.ok) throw new Error(`Mustang's download answered ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== MUSTANG_SHA256)
    throw new Error(`Mustang's jar has the SHA-256 ${digest}, not the pinned one.`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(jar, bytes);
  return jar;
}

/** Lets the checkers' containers read a folder, whatever user they run as. */
function readableByAll(path: string): void {
  const mode = statSync(path).mode;
  if (statSync(path).isDirectory()) {
    chmodSync(path, mode | 0o555);
    for (const entry of readdirSync(path)) readableByAll(join(path, entry));
  } else chmodSync(path, mode | 0o444);
}

if (
  run(process.execPath, [
    '--conditions=react-server',
    join(import.meta.dir, 'write-reference-e-invoices.ts'),
    pdfs,
  ])
)
  throw new Error('The reference invoices could not be rendered.');
const jar = await mustangJar();
for (const image of [JAVA_IMAGE, VERAPDF_IMAGE])
  if (run('docker', ['pull', '--quiet', image])) throw new Error(`docker could not pull ${image}.`);
readableByAll(pdfs);
readableByAll(join(jar, '..'));

/** Mustang's report of one PDF, kept beside the PDFs. */
const reportOf = (name: string): string => join(pdfs, `${basename(name, '.pdf')}.mustang.xml`);

/**
 * Whether Mustang accepts the PDF. It exits 0 and reports an overall "valid" when only its PDF/A
 * part fails, so any invalid part of its report counts too.
 */
function mustang(name: string): boolean {
  const { status, output } = capture('docker', [
    'run',
    '--rm',
    '--volume',
    `${pdfs}:/data:ro`,
    '--volume',
    `${join(jar, '..')}:/mustang:ro`,
    '--workdir',
    '/tmp',
    JAVA_IMAGE,
    'java',
    '-jar',
    `/mustang/${basename(jar)}`,
    '--no-notices',
    '--action',
    'validate',
    '--source',
    `/data/${name}`,
  ]);
  writeFileSync(reportOf(name), output);
  return status === 0 && !output.includes('status="invalid"') && output.includes('<summary status="valid"/>');
}

const verapdf = (name: string): { status: number; output: string } =>
  capture('docker', [
    'run',
    '--rm',
    '--volume',
    `${pdfs}:/data:ro`,
    VERAPDF_IMAGE,
    '--flavour',
    '3b',
    '--format',
    'text',
    `/data/${name}`,
  ]);

// This file is under lib/, where product code logs only through lib/logging.ts; its lines name
// made-up invoices and checker output, no personal data.
const say = (text: string): void => void process.stdout.write(`${text}\n`);
const complain = (text: string): void => void process.stderr.write(`${text}\n`);
let failed = false;
const failCheck = (message: string): void => {
  failed = true;
  complain(`::error::${message}`);
};

for (const file of readdirSync(join(pdfs, 'valid'))
  .filter((entry) => entry.endsWith('.pdf'))
  .sort()) {
  const name = `valid/${file}`;
  if (mustang(name)) say(`Mustang accepts ${name}`);
  else {
    failCheck(`Mustang refuses ${name}`);
    for (const line of readFileSync(reportOf(name), 'utf8').split('\n'))
      if (/<error|status=/.test(line)) complain(line.slice(0, 400));
  }
  const pdfa = verapdf(name);
  if (pdfa.status === 0) say(`veraPDF accepts ${name}`);
  else {
    complain(pdfa.output);
    failCheck(`veraPDF refuses ${name} as PDF/A-3b`);
  }
}

// A refusal counts only as a validation result, never as a checker that could not run or read the file.
mustang('broken/xml-changed-after-embedding.pdf');
const changedXml = readFileSync(reportOf('broken/xml-changed-after-embedding.pdf'), 'utf8');
if (changedXml.includes('<xml>') && changedXml.includes('BR-CO-15'))
  say('Mustang refuses broken/xml-changed-after-embedding.pdf with BR-CO-15, as it must');
else failCheck('Mustang did not refuse the invoice whose XML was changed after embedding');

const withoutIntent = verapdf('broken/without-output-intent.pdf');
say(withoutIntent.output);
if (
  withoutIntent.status === 1 &&
  withoutIntent.output
    .split('\n')
    .some((line) => line.startsWith('FAIL /data/broken/without-output-intent.pdf'))
)
  say('veraPDF refuses broken/without-output-intent.pdf, as it must');
else failCheck(`veraPDF did not refuse the PDF without output intent (exit ${withoutIntent.status})`);

process.exitCode = failed ? 1 : 0;
