// Browser Web Crypto helpers for end-to-end encryption of text drops.
// The server never sees plaintext — it only stores {payload, iv, salt}.
// payload = AES-GCM ciphertext || authTag (base64), matching the Web Crypto
// convention where the encrypted output already includes the tag.

const enc = new TextEncoder();
const dec = new TextDecoder();

async function deriveKey(password, saltB64) {
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function fromB64(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function encryptText(password, plaintext) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, toB64(salt));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return { payload: toB64(new Uint8Array(ct)), iv: toB64(iv), salt: toB64(salt) };
}

export async function decryptText(password, payloadB64, ivB64, saltB64) {
  const key = await deriveKey(password, saltB64);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(ivB64) },
    key,
    fromB64(payloadB64)
  );
  return dec.decode(pt);
}
