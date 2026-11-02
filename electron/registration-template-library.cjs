const crypto = require('node:crypto');
const { constants: fsConstants } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_TEMPLATE_BYTES = 25_000_000;
const templateIdPattern = /^CP-[A-F0-9]{8}$/;
const supportedSlotCounts = new Set([6, 7, 8]);
const readOnlyNoFollow = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;

function assertTemplateIdentity(templateId, slotCount) {
  if (typeof templateId !== 'string' || !templateIdPattern.test(templateId))
    throw new Error('Invalid registration template identifier.');
  if (!Number.isInteger(slotCount) || !supportedSlotCounts.has(slotCount))
    throw new Error(
      'Only six-card, seven-card, and eight-card registration templates are supported.',
    );
  return { templateId, slotCount };
}

function registrationTemplateFilename(templateId, slotCount, templateName) {
  const identity = assertTemplateIdentity(templateId, slotCount);
  if (templateName !== undefined) {
    if (
      typeof templateName !== 'string' ||
      templateName.length > 180 ||
      !/^(?:Skarix|CriProx)-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*$/.test(templateName)
    )
      throw new Error('Invalid registration template filename.');
    return `${templateName}-cricut-template.pdf`;
  }
  return `${identity.templateId}-${identity.slotCount}-cut-cricut-template.pdf`;
}

function templateBytes(value) {
  let bytes;
  if (Buffer.isBuffer(value)) bytes = value;
  else if (value instanceof ArrayBuffer) bytes = Buffer.from(value);
  else if (ArrayBuffer.isView(value))
    bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (!bytes || bytes.length < 5 || bytes.length > MAX_TEMPLATE_BYTES)
    throw new Error('Registration template PDF is invalid or exceeds 25 MB.');
  if (bytes.subarray(0, 1024).indexOf('%PDF-') < 0)
    throw new Error('Registration template must be a PDF.');
  return bytes;
}

async function saveRegistrationTemplate(root, request) {
  if (typeof root !== 'string' || !path.isAbsolute(root))
    throw new Error('Project library folder must be an absolute path.');
  const filename = registrationTemplateFilename(
    request?.templateId,
    request?.slotCount,
    request?.templateName,
  );
  const bytes = templateBytes(request?.pdf);
  await fs.mkdir(root, { recursive: true });
  const target = path.join(root, filename);
  const temporary = path.join(root, `.${filename}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx' });
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
  const stat = await fs.stat(target);
  return { name: filename, capturedAt: stat.mtime.toISOString() };
}

async function loadRegistrationTemplate(root, request) {
  if (typeof root !== 'string' || !path.isAbsolute(root))
    throw new Error('Project library folder must be an absolute path.');
  const filename = registrationTemplateFilename(
    request?.templateId,
    request?.slotCount,
    request?.templateName,
  );
  const legacyFilename = registrationTemplateFilename(request?.templateId, request?.slotCount);
  // Older captures remain available without requiring users to recapture or rename them.
  for (const candidate of new Set([filename, legacyFilename])) {
    const loaded = await readRegistrationTemplate(path.join(root, candidate), candidate);
    if (loaded) return loaded;
  }
  return null;
}

async function readRegistrationTemplate(target, filename) {
  let handle;
  try {
    handle = await fs.open(target, readOnlyNoFollow);
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Saved registration template is unavailable.');
    const contents = templateBytes(await handle.readFile());
    return {
      name: filename,
      capturedAt: stat.mtime.toISOString(),
      pdf: contents.buffer.slice(contents.byteOffset, contents.byteOffset + contents.byteLength),
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error?.code === 'ELOOP' || error?.code === 'EMLINK')
      throw new Error('Saved registration template is unavailable.');
    throw error;
  } finally {
    await handle?.close();
  }
}

module.exports = {
  MAX_TEMPLATE_BYTES,
  loadRegistrationTemplate,
  registrationTemplateFilename,
  saveRegistrationTemplate,
};
