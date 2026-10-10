import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseDataKey} from './secrets.js';

/** KEY=value lines from .env, without overriding the real environment. */
function loadDotEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(raw);
    if (!m || m[1] in process.env) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

loadDotEnv(path.resolve('.env'));

const defaultCore = path.join(os.homedir(), 'taiga', 'resources', 'linux', 'taiga-core-linux-amd64');

export const env = {
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 8787),
  /** Where subscription links point; the request's own host when empty. */
  publicUrl: (process.env.PUBLIC_URL ?? '').replace(/\/+$/, ''),
  core: process.env.TAIGA_CORE || defaultCore,
  dataDir: path.resolve(process.env.DATA_DIR || 'data'),
  /** Behind nginx or another proxy: take the client's address and scheme from its headers. */
  trustProxy: process.env.TRUST_PROXY === '1',
  /** Seals the tokens, the SSH key and the nodes' keys in data/db.json. */
  dataKey: Buffer.alloc(0) as Buffer,
};

if (!env.adminPassword) {
  console.error('Не задан ADMIN_PASSWORD: задайте его в .env или в окружении');
  process.exit(1);
}

if (!process.env.DATA_KEY) {
  console.error('Не задан DATA_KEY: им шифруются токены и ключи в data/db.json. Создайте: openssl rand -base64 32');
  process.exit(1);
}
try {
  env.dataKey = parseDataKey(process.env.DATA_KEY);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

// Everything the panel writes (db.json, panel.sqlite and its WAL, cookies) is the owner's alone.
process.umask(0o077);
fs.mkdirSync(env.dataDir, {recursive: true, mode: 0o700});
export const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taiga-web-'));
