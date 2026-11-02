// Read-only, explicitly authorized session reuse. Login tokens stay inside the cutter worker.
const fs = require('fs'),
  path = require('path'),
  snappy = require('snappyjs');

function vi(b, p) {
  let n = 0,
    m = 1;
  for (let i = 0; i < 8; i++) {
    if (p.i >= b.length) throw Error('Truncated varint');
    const v = b[p.i++];
    n += (v & 127) * m;
    if (!(v & 128)) {
      if (!Number.isSafeInteger(n)) throw Error('Large varint');
      return n;
    }
    m *= 128;
  }
  throw Error('Invalid varint');
}
function entries(b) {
  const end = b.length - 4 - 4 * b.readUInt32LE(b.length - 4),
    result = [];
  let key = Buffer.alloc(0),
    p = { i: 0 };
  if (end < 0) throw Error('Invalid block');
  while (p.i < end) {
    const shared = vi(b, p),
      n = vi(b, p),
      v = vi(b, p);
    if (shared > key.length || p.i + n + v > end) throw Error('Invalid entry');
    key = Buffer.concat([key.subarray(0, shared), b.subarray(p.i, p.i + n)]);
    p.i += n;
    result.push([key, b.subarray(p.i, p.i + v)]);
    p.i += v;
  }
  return result;
}
function readCache(dir) {
  const records = new Map();
  function add(k, v, seq, type) {
    if (!k.includes(Buffer.from('@@auth0spajs@@'))) return;
    const id = k.toString('hex'),
      old = records.get(id);
    if (!old || seq > old.seq) records.set(id, { v, seq, type });
  }
  for (const name of fs.readdirSync(dir)) {
    if (!/\.(ldb|log)$/.test(name)) continue;
    const file = path.join(dir, name);
    if (fs.statSync(file).size > 32 * 1024 * 1024) throw Error('Oversized store file');
    const b = fs.readFileSync(file);
    if (name.endsWith('.ldb')) {
      if (b.length < 48) continue;
      const footer = { i: b.length - 48 };
      vi(b, footer);
      vi(b, footer);
      const off = vi(b, footer),
        size = vi(b, footer);
      function block(o, n) {
        if (o + n + 5 > b.length) throw Error('Invalid handle');
        const data = b.subarray(o, o + n),
          type = b[o + n];
        if (type === 0) return data;
        if (type === 1) return Buffer.from(snappy.uncompress(data, 8 * 1024 * 1024));
        throw Error('Unsupported compression');
      }
      for (const [k, v] of entries(block(off, size))) {
        const p = { i: 0 },
          o = vi(v, p),
          n = vi(v, p);
        for (const [key, value] of entries(block(o, n))) {
          if (key.length < 8) continue;
          const tag = key.readBigUInt64LE(key.length - 8);
          add(key.subarray(0, -8), value, tag >> 8n, Number(tag & 255n));
        }
      }
    } else {
      let chunks = [];
      for (let start = 0; start < b.length; start += 32768) {
        const end = Math.min(b.length, start + 32768);
        let p = start;
        while (p + 7 <= end) {
          const len = b.readUInt16LE(p + 4),
            type = b[p + 6];
          p += 7;
          if (!type) break;
          if (p + len > end) break;
          const part = b.subarray(p, p + len);
          p += len;
          if (type === 1) chunks = [part];
          else if (type === 2) {
            chunks = [part];
            continue;
          } else if (type === 3) {
            chunks.push(part);
            continue;
          } else if (type === 4) chunks.push(part);
          else continue;
          const batch = Buffer.concat(chunks);
          chunks = [];
          if (batch.length < 12) continue;
          let seq = batch.readBigUInt64LE(0);
          const count = batch.readUInt32LE(8),
            q = { i: 12 };
          for (let i = 0; i < count; i++) {
            const kind = batch[q.i++],
              kn = vi(batch, q),
              key = batch.subarray(q.i, q.i + kn);
            q.i += kn;
            let value = Buffer.alloc(0);
            if (kind === 1) {
              const vn = vi(batch, q);
              value = batch.subarray(q.i, q.i + vn);
              q.i += vn;
            }
            add(key, value, seq++, kind);
          }
        }
      }
    }
  }
  const out = [];
  for (const [cacheKey, r] of records.entries()) {
    if (r.type !== 1 || !r.v.length) continue;
    const text = r.v.subarray(1).toString(r.v[0] === 0 ? 'utf16le' : 'latin1');
    try {
      const d = JSON.parse(text);
      out.push({ ...d, cacheKey: Buffer.from(cacheKey, 'hex').toString('latin1') });
    } catch {}
  }
  return out;
}

function sessionFromCache(records, now = Date.now()) {
  const access = records.filter(
    (e) =>
      e.expiresAt * 1000 > now + 60000 &&
      e.body?.audience === 'https://apis.cricut.com/public' &&
      typeof e.body.access_token === 'string' &&
      e.body.access_token.length <= 16384,
  );
  if (access.length !== 1)
    throw Error(
      'Open Design Space and sign in again, then close it before connecting. No unique current Cricut session was found.',
    );
  const token = access[0],
    client = token.body.client_id;
  const identities = records.filter(
    (e) =>
      typeof client === 'string' &&
      typeof e.cacheKey === 'string' &&
      e.cacheKey.includes(client) &&
      e.decodedToken?.user?.['https://apis.cricut.com/claims/cricut-user-id'],
  );
  if (identities.length !== 1)
    throw Error('The Cricut account could not be identified. Sign in again in Design Space.');
  const userId = String(
    identities[0].decodedToken.user['https://apis.cricut.com/claims/cricut-user-id'],
  );
  if (!/^\d{1,20}$/.test(userId)) throw Error('Invalid Cricut account identifier.');
  return { accessToken: token.body.access_token, userId };
}
async function getMachineKey(
  applicationVersion,
  {
    authorized = false,
    profile = require('node:os').homedir(),
    fetchImpl = fetch,
    machine = 'explore-5',
  } = {},
) {
  const model = require('./bifrost-device.cjs').bifrostMachine(machine);
  if (!authorized)
    throw Error('Authorize use of the signed-in Design Space session before connecting.');
  if (applicationVersion !== '10.8.81')
    throw Error(
      'Authenticated connections currently require the inspected Design Space 10.8.81 build.',
    );
  if (!profile) throw Error('Your home directory is unavailable.');
  let session;
  try {
    session = sessionFromCache(
      readCache(path.join(profile, '.cricut-design-space', 'UserData', 'Local Storage', 'leveldb')),
    );
  } catch (e) {
    throw Error(
      e.message.startsWith('Open Design Space') || e.message.startsWith('The Cricut account')
        ? e.message
        : 'Could not read the Design Space session. Open Design Space and sign in, then close it.',
    );
  }
  const client = 'design3.appdesign@' + applicationVersion;
  let r;
  try {
    r = await fetchImpl(
      `https://apis.cricut.com/machine/v2/Machines/settings/${model.machineFamily}`,
      {
        method: 'GET',
        redirect: 'error',
        headers: {
          Authorization: 'Bearer ' + session.accessToken,
          'X-Cricut-Client': client,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(15000),
      },
    );
  } catch {
    throw Error('Could not reach Cricut machine settings. Check your internet connection.');
  } finally {
    session.accessToken = undefined;
  }
  if (!r.ok)
    throw Error(
      r.status === 401
        ? 'Cricut sign-in expired. Sign in again in Design Space.'
        : 'Cricut machine settings returned HTTP ' + r.status + '.',
    );
  let d;
  try {
    d = await r.json();
  } catch {
    throw Error('Invalid Cricut machine settings response.');
  }
  if (!d || typeof d.key !== 'string' || d.key.length > 32768)
    throw Error('Cricut did not supply a supported machine key.');
  const hash = require('crypto')
      .createHash('sha512')
      .update(session.userId + client)
      .digest(),
    raw = Buffer.from(d.key, 'base64');
  try {
    for (let i = 0; i < raw.length; i++) raw[i] ^= hash[i % hash.length];
    const key = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    if (!key.length || key.length > 16384) throw Error();
    return key;
  } catch {
    throw Error('The machine key could not be decoded for this account.');
  } finally {
    raw.fill(0);
    hash.fill(0);
    d.key = undefined;
  }
}
module.exports = { getMachineKey, sessionFromCache, readCache };
