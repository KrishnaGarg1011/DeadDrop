// Server-side AES-256-GCM encryption for stored files ("encrypted at rest").
// The on-disk bytes are ciphertext; the key, IV and auth tag are kept in the
// database. Files are decrypted on download, so the API still streams a normal
// file while the disk never holds plaintext.
import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';

export const newFileKey = () => crypto.randomBytes(32);

export function encryptBuffer(buffer, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { enc, iv, tag };
}

export function decryptBuffer(enc, key, iv, tag) {
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}
