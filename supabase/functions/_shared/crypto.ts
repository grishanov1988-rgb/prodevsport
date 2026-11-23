// ============================================================
//  SHA-256 / HMAC-SHA256 НА ЧИСТОМ JS
//  Точный порт проверенного кода из Code.gs (GAS-версия).
//  Нужен для валидации Telegram initData: двойной HMAC,
//  байтовый ключ — стандартные библиотеки тут не подходят.
// ============================================================

const K = [
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
];

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/** Вход: массив байт, выход: массив из 32 байт */
export function sha256Bytes(msg: number[]): number[] {
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const bitLen = msg.length * 8;
  const withPad = msg.slice();
  withPad.push(0x80);
  while (withPad.length % 64 !== 56) withPad.push(0);
  for (let i = 7; i >= 0; i--) withPad.push(Math.floor(bitLen / Math.pow(2, i * 8)) & 0xff);

  for (let off = 0; off < withPad.length; off += 64) {
    const w: number[] = new Array(64);
    for (let t = 0; t < 16; t++) {
      const j = off + t * 4;
      w[t] = ((withPad[j] << 24) | (withPad[j+1] << 16) | (withPad[j+2] << 8) | withPad[j+3]) >>> 0;
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t-15],7) ^ rotr(w[t-15],18) ^ (w[t-15] >>> 3);
      const s1 = rotr(w[t-2],17) ^ rotr(w[t-2],19) ^ (w[t-2] >>> 10);
      w[t] = (w[t-16] + s0 + w[t-7] + s1) & 0xffffffff;
    }
    let [a,b,c,d,e,f,g,hh] = h;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[t] + w[t]) & 0xffffffff;
      const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) & 0xffffffff;
      hh=g; g=f; f=e; e=(d + t1) & 0xffffffff; d=c; c=b; b=a; a=(t1 + t2) & 0xffffffff;
    }
    h[0]=(h[0]+a)&0xffffffff; h[1]=(h[1]+b)&0xffffffff; h[2]=(h[2]+c)&0xffffffff; h[3]=(h[3]+d)&0xffffffff;
    h[4]=(h[4]+e)&0xffffffff; h[5]=(h[5]+f)&0xffffffff; h[6]=(h[6]+g)&0xffffffff; h[7]=(h[7]+hh)&0xffffffff;
  }
  const out: number[] = [];
  for (const x of h) out.push((x >>> 24) & 0xff, (x >>> 16) & 0xff, (x >>> 8) & 0xff, x & 0xff);
  return out;
}

/** UTF-8 байты строки */
export function utf8Bytes(str: string): number[] {
  const out: number[] = [];
  for (let m = 0; m < str.length; m++) {
    const code = str.charCodeAt(m);
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = str.charCodeAt(++m);
      const u = 0x10000 + ((code & 0x3ff) << 10) + (next & 0x3ff);
      out.push(0xf0 | (u >> 18), 0x80 | ((u >> 12) & 0x3f), 0x80 | ((u >> 6) & 0x3f), 0x80 | (u & 0x3f));
    } else out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return out;
}

/** HMAC-SHA256: keyBytes и messageBytes — массивы байт; результат — 32 байта */
export function hmacSha256Bytes(keyBytes: number[], messageBytes: number[]): number[] {
  const blockSize = 64;
  const key = keyBytes.slice();
  if (key.length > blockSize) key.length = 0, key.push(...sha256Bytes(keyBytes));
  while (key.length < blockSize) key.push(0);
  const o: number[] = [], i: number[] = [];
  for (let n = 0; n < blockSize; n++) { o.push(key[n] ^ 0x5c); i.push(key[n] ^ 0x36); }
  return sha256Bytes(o.concat(sha256Bytes(i.concat(messageBytes))));
}

/** HMAC-SHA256: keyBytes — массив байт, message — строка; результат — hex */
export function hmacSha256Hex(keyBytes: number[], message: string): string {
  const outer = hmacSha256Bytes(keyBytes, utf8Bytes(message));
  let hex = '';
  for (const b of outer) hex += (b < 16 ? '0' : '') + b.toString(16);
  return hex;
}

// --- Валидация Telegram initData (стандарт Telegram) ---
export function validateInitData(initData: string, botToken: string): Record<string, unknown> | null {
  if (!initData || !botToken) return null;
  try {
    const params: Record<string, string> = {};
    for (const p of initData.split('&')) {
      const i = p.indexOf('=');
      if (i > 0) params[p.substring(0, i)] = decodeURIComponent(p.substring(i + 1));
    }
    const hash = params.hash || '';
    if (!hash) return null;

    const checkString = Object.keys(params)
      .filter((k) => k !== 'hash')
      .sort()
      .map((k) => k + '=' + params[k])
      .join('\n');

    // secret = HMAC-SHA256(key="WebAppData", msg=TOKEN)
    const secretKey = hmacSha256Bytes(utf8Bytes('WebAppData'), utf8Bytes(botToken));
    const computed = hmacSha256Hex(secretKey, checkString);

    if (computed !== hash) return null;
    return params.user ? JSON.parse(params.user) : {};
  } catch {
    return null;
  }
}
