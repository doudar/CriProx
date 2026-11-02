import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { templateFilenameStem } from '../src/lib/filenames';
import { DEFAULT_SETTINGS } from '../src/lib/types';
import { templateId } from '../src/lib/registration';

const require = createRequire(import.meta.url);
const { loadRegistrationTemplate, registrationTemplateFilename, saveRegistrationTemplate } =
  require('../electron/registration-template-library.cjs') as {
    loadRegistrationTemplate: (
      root: string,
      request: { templateId: string; slotCount: number; templateName?: string },
    ) => Promise<{ name: string; capturedAt: string; pdf: ArrayBuffer } | null>;
    registrationTemplateFilename: (
      templateId: string,
      slotCount: number,
      templateName?: string,
    ) => string;
    saveRegistrationTemplate: (
      root: string,
      request: { templateId: string; slotCount: number; pdf: Uint8Array; templateName?: string },
    ) => Promise<{ name: string; capturedAt: string }>;
  };

const identity = { templateId: 'CP-1234ABCD', slotCount: 6 };

test('registration templates are saved and replaced at the project library root', async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'criprox-template-library-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const first = new TextEncoder().encode('%PDF-1.7\nfirst');
  const second = new TextEncoder().encode('%PDF-1.7\nreplacement');

  const saved = await saveRegistrationTemplate(root, { ...identity, pdf: first });
  assert.equal(saved.name, 'CP-1234ABCD-6-cut-cricut-template.pdf');
  assert.deepEqual(await fs.readdir(root), [saved.name]);

  await saveRegistrationTemplate(root, { ...identity, pdf: second });
  const loaded = await loadRegistrationTemplate(root, identity);
  assert.equal(loaded?.name, saved.name);
  assert.deepEqual(new Uint8Array(loaded?.pdf || new ArrayBuffer(0)), second);
});

test('registered templates have distinct path-safe names', () => {
  assert.equal(
    registrationTemplateFilename('CP-1234ABCD', 6),
    'CP-1234ABCD-6-cut-cricut-template.pdf',
  );
  assert.equal(
    registrationTemplateFilename('CP-ABCDEF12', 7),
    'CP-ABCDEF12-7-cut-cricut-template.pdf',
  );
  assert.equal(
    registrationTemplateFilename('CP-ABCDEF12', 8),
    'CP-ABCDEF12-8-cut-cricut-template.pdf',
  );
  assert.throws(() => registrationTemplateFilename('../escape', 6));
  assert.throws(() => registrationTemplateFilename('CP-1234ABCD', 9));
});

test('registration template storage rejects non-PDF data', async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'criprox-template-library-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await assert.rejects(
    saveRegistrationTemplate(root, {
      ...identity,
      pdf: new TextEncoder().encode('not a pdf'),
    }),
    /must be a PDF/,
  );
  assert.deepEqual(await fs.readdir(root), []);
});

const readableIdentity = {
  templateId: templateId(DEFAULT_SETTINGS),
  slotCount: 6,
  templateName: templateFilenameStem(DEFAULT_SETTINGS),
};

test('new captures use readable names and retain distinct geometry', async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'criprox-template-names-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bytes = new TextEncoder().encode('%PDF-1.7\nreadable');
  const saved = await saveRegistrationTemplate(root, { ...readableIdentity, pdf: bytes });
  assert.equal(
    saved.name,
    'Skarix-maker-US-Letter-6-card-expanded-63x88mm-gap-1mm-radius-2.5mm-cricut-template.pdf',
  );
  assert.deepEqual(await fs.readdir(root), [saved.name]);
  const loaded = await loadRegistrationTemplate(root, readableIdentity);
  assert.equal(loaded?.name, saved.name);
  assert.deepEqual(new Uint8Array(loaded!.pdf), bytes);

  const otherSettings = { ...DEFAULT_SETTINGS, gap: 2 };
  const other = {
    ...readableIdentity,
    templateId: templateId(otherSettings),
    templateName: templateFilenameStem(otherSettings),
  };
  assert.equal(await loadRegistrationTemplate(root, other), null);
  const second = await saveRegistrationTemplate(root, { ...other, pdf: bytes });
  assert.notEqual(second.name, saved.name);
  assert.equal((await fs.readdir(root)).length, 2);
});

test('readable template lookup falls back to existing captures and prefers replacements', async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'criprox-template-legacy-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const legacy = new TextEncoder().encode('%PDF-1.7\nlegacy');
  const replacement = new TextEncoder().encode('%PDF-1.7\nreplacement');
  const { templateName, ...oldIdentity } = readableIdentity;
  await saveRegistrationTemplate(root, { ...oldIdentity, pdf: legacy });
  const loaded = await loadRegistrationTemplate(root, readableIdentity);
  assert.deepEqual(new Uint8Array(loaded!.pdf), legacy);
  await saveRegistrationTemplate(root, { ...readableIdentity, pdf: replacement });
  assert.deepEqual(
    new Uint8Array((await loadRegistrationTemplate(root, readableIdentity))!.pdf),
    replacement,
  );
});

test('readable template names reject traversal, reserved punctuation, and oversized names', async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'criprox-template-safe-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const templateName of [
    '../escape',
    'Skarix-../escape',
    'Skarix-test.pdf/elsewhere',
    'Skarix-test:name',
    'Skarix-' + 'x'.repeat(181),
  ]) {
    await assert.rejects(
      saveRegistrationTemplate(root, {
        ...readableIdentity,
        templateName,
        pdf: new TextEncoder().encode('%PDF-1.7'),
      }),
      /Invalid registration template filename/,
    );
  }
  assert.deepEqual(await fs.readdir(root), []);
});
