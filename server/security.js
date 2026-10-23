'use strict';
// Segurança: senhas (Argon2id se disponível, senão scrypt), AES-256-GCM, TOTP, limites de taxa.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let argon2 = null;
try { argon2 = require('argon2'); } catch { /* opcional: npm i argon2 */ }

const scryptAsync = (pw, salt, n, r, p) => new Promise((res, rej) =>
  crypto.scrypt(pw.normalize('NFKC'), salt, 64, { N: n, r, p, maxmem: 256 * 1024 * 1024 }, (e, k) => e ? rej(e) : res(k)));

async function hashPassword(pw) {
  if (argon2) return argon2.hash(pw, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const salt = crypto.randomBytes(16), N = 1 << 15, r = 8, p = 1;
  const k = await scryptAsync(pw, salt, N, r, p);
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${k.toString('base64')}`;
}
async function verifyPassword(pw, stored) {
  try {
    if (stored.startsWith('$argon2')) return argon2 ? await argon2.verify(stored, pw) : false;
    const [, N, r, p, salt, hash] = stored.split('$');
    const k = await scryptAsync(pw, Buffer.from(salt, 'base64'), +N, +r, +p);
    const h = Buffer.from(hash, 'base64');
    return h.length === k.length && crypto.timingSafeEqual(h, k);
  } catch { return false; }
}
let dummy; // evita revelar se o usuário existe pelo tempo de resposta
async function dummyVerify(pw) { dummy ||= await hashPassword('dummy-password-value'); await verifyPassword(pw, dummy); }

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const token = (n = 32) => crypto.randomBytes(n).toString('base64url');
const rid = (p) => p + crypto.randomBytes(9).toString('base64url');

// Chave mestra para criptografar chaves de API (AIS_MASTER_KEY=hex de 64 chars, ou arquivo local 0600)
function loadMasterKey(dataDir) {
  if (process.env.AIS_MASTER_KEY && /^[0-9a-f]{64}$/i.test(process.env.AIS_MASTER_KEY)) return Buffer.from(process.env.AIS_MASTER_KEY, 'hex');
  const f = path.join(dataDir, 'master.key');
  if (fs.existsSync(f)) return Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex');
  const k = crypto.randomBytes(32);
  fs.writeFileSync(f, k.toString('hex'), { mode: 0o600 });
  return k;
}
let MK;
const initKey = dir => { MK = loadMasterKey(dir); };
function encrypt(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', MK, iv);
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function decrypt(b64) {
  const b = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', MK, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

// TOTP (RFC 6238)
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32enc(buf) { let bits = '', out = ''; for (const b of buf) bits += b.toString(2).padStart(8, '0'); for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]; return out; }
function b32dec(s) { let bits = ''; for (const c of s.replace(/=+$/, '').toUpperCase()) bits += B32.indexOf(c).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
function hotp(secret, counter) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secret).update(buf).digest(), o = h[19] & 15;
  return String(((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6).padStart(6, '0');
}
// retorna o passo válido (para impedir reutilização) ou null
function totpCheck(secretB32, code, lastStep = 0) {
  const step = Math.floor(Date.now() / 30000), s = b32dec(secretB32);
  for (const d of [0, -1, 1]) if (step + d > lastStep && hotp(s, step + d) === String(code).trim()) return step + d;
  return null;
}
const newTotpSecret = () => b32enc(crypto.randomBytes(20));

function newRecoveryCodes(n = 10) {
  return Array.from({ length: n }, () => { const h = crypto.randomBytes(5).toString('hex'); return h.slice(0, 5) + '-' + h.slice(5); });
}

// Limitador de taxa em memória
const buckets = new Map();
function hit(key, max, windowMs) {
  const now = Date.now(); let b = buckets.get(key);
  if (!b || b.reset < now) b = { n: 0, reset: now + windowMs };
  b.n++; buckets.set(key, b);
  return { ok: b.n <= max, retryAfter: Math.ceil((b.reset - now) / 1000) };
}
const clearHits = key => buckets.delete(key);
setInterval(() => { const n = Date.now(); for (const [k, b] of buckets) if (b.reset < n) buckets.delete(k); }, 60000).unref();

function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'A senha precisa ter pelo menos 10 caracteres.';
  if (pw.length > 200) return 'A senha é longa demais.';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9\W_]/.test(pw)) return 'Use letras e pelo menos um número ou símbolo.';
  if (/^(.)\1+$/.test(pw) || /^(password|senha|qwerty|12345678|abcdefgh)\w{0,3}$/i.test(pw)) return 'Essa senha é fácil demais de adivinhar.';
  return null;
}

module.exports = { hashPassword, verifyPassword, dummyVerify, sha256, token, rid, initKey, encrypt, decrypt, totpCheck, newTotpSecret, newRecoveryCodes, hit, clearHits, passwordProblem, totpNow: s => hotp(b32dec(s), Math.floor(Date.now() / 30000)), usingArgon2: () => !!argon2 };
