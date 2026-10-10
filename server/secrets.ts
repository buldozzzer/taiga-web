import crypto from 'node:crypto';

// Secrets in data/db.json are sealed with DATA_KEY from .env: a copy of data/
// alone (a backup, a disk snapshot) gives nothing without it. The running panel
// keeps them open in memory, so this does not help against someone on the server.

const PREFIX = 'enc:v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** DATA_KEY as typed: 32 random bytes in base64 (openssl rand -base64 32). */
export function parseDataKey(text: string): Buffer {
  const key = Buffer.from(text.trim(), 'base64');
  if (key.length !== 32) throw new Error('DATA_KEY должен быть 32 байтами в base64: openssl rand -base64 32');
  return key;
}

export const isSealed = (value: string) => value.startsWith(PREFIX);

/**
 * AES-256-GCM with a fresh IV each time. `where` (the field's place, such as
 * "settings.yandexToken") is bound in as associated data: a value moved to
 * another field does not open.
 */
export function seal(key: Buffer, where: string, value: string): string {
  if (!value) return '';
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(where));
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

/** The value back; a plain one (from before encryption) passes through as it is. */
export function open(key: Buffer, where: string, value: string): string {
  if (!isSealed(value)) return value;
  const raw = Buffer.from(value.slice(PREFIX.length), 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES));
  decipher.setAAD(Buffer.from(where));
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  try {
    return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
  } catch {
    throw new Error(`Не удалось расшифровать ${where}: DATA_KEY не тот, которым шифровали data/db.json`);
  }
}
