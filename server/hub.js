'use strict';
const conns = new Map(); // userId -> Set<Conn>
const hub = {
  add(uid, c) { (conns.get(uid) || conns.set(uid, new Set()).get(uid)).add(c); },
  remove(uid, c) { const s = conns.get(uid); if (s) { s.delete(c); if (!s.size) conns.delete(uid); } },
  online: uid => (conns.get(uid)?.size || 0) > 0,
  emit(uid, ev) { for (const c of conns.get(uid) || []) c.send(ev); },
  emitMany(uids, ev) { for (const u of new Set(uids)) hub.emit(u, ev); },
  all: () => conns,
};
module.exports = hub;
