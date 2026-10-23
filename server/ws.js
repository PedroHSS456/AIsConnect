'use strict';
// Servidor WebSocket mínimo (RFC 6455) sem dependências.
const crypto = require('crypto');
const { EventEmitter } = require('events');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', MAX = 1 << 20;

class Conn extends EventEmitter {
  constructor(socket) {
    super(); this.socket = socket; this.buf = Buffer.alloc(0); this.frag = []; this.fragOp = 0; this.alive = true; this.open = true;
    socket.setNoDelay(true);
    socket.on('data', d => { this.buf = Buffer.concat([this.buf, d]); try { this.parse(); } catch { this.close(1002); } });
    socket.on('close', () => { this.open = false; this.emit('close'); });
    socket.on('error', () => {});
  }
  parse() {
    for (;;) {
      const b = this.buf; if (b.length < 2) return;
      const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80; let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (len > MAX || !masked) return this.close(len > MAX ? 1009 : 1002);
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4), p = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < p.length; i++) p[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      if (op === 8) return this.close(1000);
      if (op === 9) { this.frame(10, p); continue; }
      if (op === 10) { this.alive = true; continue; }
      if (op === 1 || op === 2) { this.fragOp = op; this.frag = [p]; } else if (op === 0) this.frag.push(p); else return this.close(1002);
      if (fin) { const data = Buffer.concat(this.frag); this.frag = []; if (this.fragOp === 1) this.emit('message', data.toString('utf8')); }
    }
  }
  frame(op, payload) {
    if (!this.open) return;
    const n = payload.length; let h;
    if (n < 126) h = Buffer.from([0x80 | op, n]);
    else if (n < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(n, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); }
    this.socket.write(Buffer.concat([h, payload]));
  }
  send(obj) { this.frame(1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj))); }
  ping() { this.alive = false; this.frame(9, Buffer.alloc(0)); }
  close(code = 1000) { if (!this.open) return; const p = Buffer.alloc(2); p.writeUInt16BE(code); this.frame(8, p); this.open = false; this.socket.end(); }
}

function upgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') { socket.destroy(); return null; }
  const acc = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acc}\r\n\r\n`);
  return new Conn(socket);
}
module.exports = { upgrade };
