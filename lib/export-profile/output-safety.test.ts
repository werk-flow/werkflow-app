import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { decideOutputFolder, selfCheckOutput } from './output-safety';
import { exportLabel, maskShape, type PersonalDataKind } from './personal-data';

let workspace = '';

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'export-profile-safety-'));
  mkdirSync(join(workspace, 'export'));
  mkdirSync(join(workspace, 'home'));
  mkdirSync(join(workspace, 'repository', '.git'), { recursive: true });
  mkdirSync(join(workspace, 'repository', 'exports', 'willert'), { recursive: true });
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const decide = (input: string, requestedOutput: string | null) =>
  decideOutputFolder({ input, requestedOutput, home: join(workspace, 'home'), today: '2026-11-05' });

describe('output safety: where the profile may go', () => {
  test('refuses an output folder inside a Git repository, also one that does not exist yet', () => {
    expect(decide(join(workspace, 'export'), join(workspace, 'repository', 'profiles', 'new'))).toEqual({
      ok: false,
      reason: 'output_inside_repository',
    });
  });

  test('refuses an export folder inside a Git repository', () => {
    expect(decide(join(workspace, 'repository', 'exports', 'willert'), null)).toEqual({
      ok: false,
      reason: 'input_inside_repository',
    });
  });

  test('refuses an output folder inside the export, a missing export and a non-empty output folder', () => {
    expect(decide(join(workspace, 'export'), join(workspace, 'export', 'profile'))).toEqual({
      ok: false,
      reason: 'output_overlaps_input',
    });
    expect(decide(join(workspace, 'missing'), null)).toEqual({ ok: false, reason: 'input_missing' });
    const used = join(workspace, 'used');
    mkdirSync(used);
    writeFileSync(join(used, 'notes.txt'), 'x');
    expect(decide(join(workspace, 'export'), used)).toEqual({ ok: false, reason: 'output_not_empty' });
  });

  test('defaults to a dated folder below the home folder and never reuses a filled one', () => {
    const first = decide(join(workspace, 'export'), null);
    expect(first).toEqual({
      ok: true,
      folder: expect.stringMatching(/home\/werkflow-export-profiles\/2026-11-05$/),
    });
    if (!first.ok) return;
    mkdirSync(first.folder, { recursive: true });
    writeFileSync(join(first.folder, 'profile.md'), '# Export profile');
    expect(decide(join(workspace, 'export'), null)).toEqual({ ok: true, folder: `${first.folder}-2` });
  });

  test('refuses a numbered output folder that links into a Git repository', () => {
    const home = join(workspace, 'linked-home');
    const base = join(home, 'werkflow-export-profiles', '2026-11-05');
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'profile.md'), '# Export profile');
    const target = join(workspace, 'repository', 'empty-target');
    mkdirSync(target);
    symlinkSync(target, `${base}-2`);
    expect(
      decideOutputFolder({
        input: join(workspace, 'export'),
        requestedOutput: null,
        home,
        today: '2026-11-05',
      }),
    ).toEqual({ ok: false, reason: 'output_inside_repository' });
  });

  test('refuses an output folder inside this repository or a worktree of it', () => {
    expect(decide(join(workspace, 'export'), join(import.meta.dir, 'profile'))).toEqual({
      ok: false,
      reason: 'output_inside_repository',
    });
  });
});

describe('output safety: the self-check', () => {
  test.each<[PersonalDataKind, string]>([
    ['email', 'Kontakt: anna.schmidt@example.de'],
    ['phone', 'Rückruf unter 030 23125 456'],
    ['iban', 'Konto DE89 3704 0044 0532 0130 00'],
    ['street_address', 'Lieferung an Hauptstraße 12'],
    ['postal_code_and_place', 'in 10115 Berlin'],
    ['salutation_and_name', 'Ansprechpartner Herr Obermeier'],
    ['person_name', 'Mitarbeiter Jürgen'],
    ['person_name', 'Kunde MÜLLER'],
    ['person_name', 'Kunde MUELLER'],
    ['person_name', 'Kunde Mu\u0308ller'],
  ])('finds a %s and names its line, never its text', (kind, line) => {
    const findings = selfCheckOutput([
      { file: 'profile.md', text: `# Export profile\n\n## Tables\n${line}` },
    ]);
    expect(findings).toContainEqual({ file: 'profile.md', line: 4, kind, section: 'Tables' });
    expect(JSON.stringify(findings)).not.toContain(line);
  });

  test('passes masked shapes, labels, counts and year ranges', () => {
    const clean = [
      '| E-Mail | email | 16.7 % | 5 | 15 to 26 | `xxxxxxx.xxxxxxx@xxxxxxx.xx` |  |  |',
      '| Telefon | phone | 0 % | 6 | 13 to 16 | `+99 99 99999 999` |  |  |',
      '| IBAN | iban | 0 % | 3 | 27 to 27 | `XX99 9999 9999 9999 9999 99` |  |  |',
      '| Strasse | text | 0 % | 6 | 9 to 14 | `Xxxxxxxxxxx 99` |  |  |',
      '| Angelegt | date | 0 % | 6 | 10 to 10 | `99.99.9999` | 2019 to 2024 |  |',
      '"bytes": 1048576, "rows": 10234, "emptyRate": 0.0123',
    ].join('\n');
    expect(selfCheckOutput([{ file: 'profile.md', text: clean }])).toEqual([]);
  });
});

describe('output safety: masking', () => {
  test('a shape keeps punctuation and spaces and replaces letters and digits', () => {
    expect(maskShape('Müller 12')).toBe('Xxxxxx 99');
    expect(maskShape('juergen.mueller@example.de')).toBe('xxxxxxx.xxxxxxx@xxxxxxx.xx');
    expect(maskShape('Zeile 1\r\nZeile 2')).toBe('Xxxxx 9  Xxxxx 9');
    expect(maskShape('x'.repeat(50))).toBe(`${'x'.repeat(40)}…`);
  });

  test('a label that looks like personal data is masked; a schema label is not', () => {
    expect(exportLabel('Kundennummer', false)).toBe('Kundennummer');
    expect(exportLabel('Müller Jürgen', false)).toBe('Xxxxxx Xxxxxx');
    expect(exportLabel('Baustelle Hauptstraße 12', false)).toBe('Xxxxxxxxx Xxxxxxxxxxx 99');
    expect(exportLabel('Kundennummer', true)).toBe('Xxxxxxxxxxxx');
  });
});

describe('export profiler: no network', () => {
  // Rule test: the profiler imports only local modules and Node built-ins
  // without network access, so the export cannot leave the machine through it.
  test('every import is relative or an offline Node built-in', () => {
    const allowed = new Set(['node:fs', 'node:path', 'node:os', 'node:crypto', 'node:zlib', 'node:util']);
    const folder = resolve(import.meta.dir);
    const sources = [
      ...readdirSync(folder)
        .filter((name) => name.endsWith('.ts') && !name.includes('.test.'))
        .map((name) => join(folder, name)),
      resolve(folder, '../../scripts/migration/profile-export.ts'),
    ];
    const offending: string[] = [];
    for (const source of sources) {
      const text = readFileSync(source, 'utf8');
      for (const match of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
        const specifier = match[1] ?? '';
        if (!specifier.startsWith('.') && !allowed.has(specifier)) offending.push(`${source}: ${specifier}`);
      }
      if (/\bfetch\s*\(|\bBun\.(?:connect|listen|serve)\b|WebSocket/.test(text))
        offending.push(`${source}: network call`);
    }
    expect(offending).toEqual([]);
  });
});
