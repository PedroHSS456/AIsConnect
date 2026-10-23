'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs'), path = require('path');

function open(dataDir) {
  fs.mkdirSync(path.join(dataDir, 'files'), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'aisconnect.db'));
  db.exec(`
PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE NOT NULL, number TEXT UNIQUE NOT NULL,
  pw_hash TEXT NOT NULL, avatar TEXT, bio TEXT DEFAULT '', privacy TEXT DEFAULT '{}',
  totp_secret TEXT, totp_on INTEGER DEFAULT 0, totp_step INTEGER DEFAULT 0, recovery TEXT DEFAULT '[]',
  created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT UNIQUE NOT NULL,
  device TEXT, ip TEXT, created INTEGER, last_seen INTEGER, expires INTEGER, revoked INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS security_events(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, type TEXT, ip TEXT, ts INTEGER);
CREATE TABLE IF NOT EXISTS contacts(
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, other_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL, created INTEGER, PRIMARY KEY(user_id, other_id));
CREATE TABLE IF NOT EXISTS ais(
  deleted INTEGER DEFAULT 0,
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
  provider TEXT NOT NULL, base_url TEXT, model TEXT NOT NULL, enc_key TEXT, key_hint TEXT,
  color TEXT, avatar TEXT, instructions TEXT DEFAULT '', temperature REAL, created INTEGER);
CREATE TABLE IF NOT EXISTS chats(
  id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT, description TEXT DEFAULT '', avatar TEXT, created_by TEXT,
  created INTEGER, send_by TEXT DEFAULT 'all', ctx_from INTEGER DEFAULT 0, ctx_summary TEXT, auto TEXT, dm_key TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS members(
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, kind TEXT NOT NULL, ref_id TEXT NOT NULL,
  role TEXT DEFAULT 'member', pinned INTEGER DEFAULT 0, muted INTEGER DEFAULT 0, archived INTEGER DEFAULT 0,
  delivered_seq INTEGER DEFAULT 0, read_seq INTEGER DEFAULT 0, cleared_seq INTEGER DEFAULT 0, joined INTEGER,
  PRIMARY KEY(chat_id, kind, ref_id));
CREATE INDEX IF NOT EXISTS members_ref ON members(kind, ref_id);
CREATE TABLE IF NOT EXISTS messages(
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, seq INTEGER NOT NULL,
  kind TEXT NOT NULL, sender_id TEXT, text TEXT DEFAULT '', reply_to TEXT, attachments TEXT DEFAULT '[]', mentions TEXT DEFAULT '[]',
  created INTEGER, edited INTEGER, deleted INTEGER DEFAULT 0, status TEXT DEFAULT 'done', model TEXT, error TEXT,
  forwarded INTEGER DEFAULT 0, pinned INTEGER DEFAULT 0, UNIQUE(chat_id, seq));
CREATE TABLE IF NOT EXISTS reactions(msg_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, user_id TEXT NOT NULL, emoji TEXT NOT NULL, PRIMARY KEY(msg_id, user_id, emoji));
CREATE TABLE IF NOT EXISTS shares(
  id TEXT PRIMARY KEY, ai_id TEXT NOT NULL REFERENCES ais(id) ON DELETE CASCADE, owner_id TEXT NOT NULL,
  user_id TEXT, chat_id TEXT, expires INTEGER NOT NULL, max_messages INTEGER, used_messages INTEGER DEFAULT 0,
  max_tokens INTEGER, used_tokens INTEGER DEFAULT 0, models TEXT, allow_images INTEGER DEFAULT 1, allow_files INTEGER DEFAULT 1,
  revoked INTEGER DEFAULT 0, created INTEGER);
CREATE TABLE IF NOT EXISTS usage(ai_id TEXT NOT NULL, user_id TEXT NOT NULL, messages INTEGER DEFAULT 0, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, PRIMARY KEY(ai_id, user_id));
CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY, owner_id TEXT, chat_id TEXT, name TEXT, mime TEXT, size INTEGER, created INTEGER);
`);
  const cache = new Map();
  const st = sql => cache.get(sql) || (cache.set(sql, db.prepare(sql)), cache.get(sql));
  return {
    raw: db,
    get: (sql, ...p) => st(sql).get(...p),
    all: (sql, ...p) => st(sql).all(...p),
    run: (sql, ...p) => st(sql).run(...p),
    tx(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } },
  };
}
module.exports = { open };
