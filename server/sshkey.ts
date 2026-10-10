import crypto from 'node:crypto';
import type {SshKeyInfo} from '../shared/panel.js';

/** A length-prefixed SSH string at `at`. */
function sshString(buf: Buffer, at: number): [Buffer, number] {
  if (at + 4 > buf.length) throw new Error('short');
  const len = buf.readUInt32BE(at);
  if (at + 4 + len > buf.length) throw new Error('short');
  return [buf.subarray(at + 4, at + 4 + len), at + 4 + len];
}

const PEM = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/;

/**
 * What the key is, read the way ssh-keygen -l does: an OpenSSH key keeps its
 * public half in the clear, so type and fingerprint read even under a
 * passphrase. A PEM key is checked by Node, with the passphrase if it has one.
 */
export function readSshKey(text: string, passphrase: string): SshKeyInfo {
  const m = PEM.exec(text.trim());
  if (!m) throw new Error('Это не приватный ключ: нужен блок -----BEGIN … PRIVATE KEY-----');
  if (m[1] === 'OPENSSH PRIVATE KEY') {
    const buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
    const magic = Buffer.from('openssh-key-v1\0');
    if (!buf.subarray(0, magic.length).equals(magic)) throw new Error('Ключ OpenSSH повреждён');
    try {
      let at = magic.length;
      const [cipher, a1] = sshString(buf, at);
      const [, a2] = sshString(buf, a1); // kdf name
      const [, a3] = sshString(buf, a2); // kdf options
      at = a3 + 4; // number of keys: one
      const [publicKey] = sshString(buf, at);
      const [type] = sshString(publicKey, 0);
      const encrypted = cipher.toString() !== 'none';
      if (encrypted && !passphrase) throw new Error('Ключ зашифрован: укажите его пароль');
      return {
        type: type.toString().replace(/^ssh-/, ''),
        fingerprint: `SHA256:${crypto.createHash('sha256').update(publicKey).digest('base64').replace(/=+$/, '')}`,
        encrypted,
      };
    } catch (e) {
      if ((e as Error).message.startsWith('Ключ')) throw e;
      throw new Error('Ключ OpenSSH повреждён');
    }
  }
  if (!m[1].includes('PRIVATE KEY')) throw new Error('Нужен приватный ключ, а не публичный');
  let key: crypto.KeyObject;
  try {
    key = crypto.createPrivateKey({key: text.trim(), passphrase: passphrase || undefined});
  } catch {
    throw new Error(/ENCRYPTED/.test(text) && !passphrase ? 'Ключ зашифрован: укажите его пароль' : 'Не удалось прочитать ключ: проверьте его и пароль');
  }
  return {type: key.asymmetricKeyType ?? 'pem', fingerprint: '', encrypted: /ENCRYPTED/.test(text)};
}
