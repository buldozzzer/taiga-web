import {cleanYandexDocument} from '../shared/model.js';
import {emptyDocx} from './docx.js';

const API = 'https://cloud-api.yandex.net/v1/disk';
const TIMEOUT_MS = 20_000;
/** The browser Yandex sees, the core's own. */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:153.0) Gecko/20100101 Firefox/153.0';
const EDIT_LINK = /https:\/\/(?:docs|disk)\.yandex\.(?:ru|com|by|kz|uz)\/edit\/d\/[A-Za-z0-9_-]{16,200}/;

export class DiskError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

/** What the Disk's REST API answers, with its own error text when it refuses. */
async function call<T>(token: string, method: string, pathAndQuery: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${API}${pathAndQuery}`, {
      method,
      headers: {Authorization: `OAuth ${token}`, Accept: 'application/json', ...(body ? {'Content-Type': 'application/json'} : {})},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new DiskError(`Яндекс Диск не ответил: ${(e as Error).message}`);
  }
  const text = await r.text();
  const json = text ? JSON.parse(text) : {};
  if (!r.ok) {
    const reason = json.message || json.description || json.error || `ответ ${r.status}`;
    throw new DiskError(r.status === 401 ? 'Токен Яндекса не принят: получите новый' : `Яндекс Диск: ${reason}`, r.status);
  }
  return json as T;
}

const q = (path: string) => `path=${encodeURIComponent(path)}`;

/** Whose Disk the token opens. */
export async function diskUser(token: string): Promise<string> {
  const info = await call<{user?: {display_name?: string; login?: string}}>(token, 'GET', '');
  return info.user?.display_name || info.user?.login || 'Яндекс';
}

/** Makes the folder only when it is missing: the Disk may answer an existing one with 423 instead of 409. */
async function ensureFolder(token: string, folder: string) {
  folder = folder.replace(/\/+$/, '');
  try {
    await call(token, 'GET', `/resources?${q(folder)}&fields=type&limit=0`);
    return;
  } catch (e) {
    if (!(e instanceof DiskError && e.status === 404)) throw e;
  }
  // The Disk makes one level at a time: a missing parent comes first.
  const parent = folder.slice(0, folder.lastIndexOf('/'));
  if (parent && !parent.endsWith(':')) await ensureFolder(token, parent);
  try {
    await call(token, 'PUT', `/resources?${q(folder)}`);
  } catch (e) {
    if (!(e instanceof DiskError && e.status === 409)) throw e;
  }
}

async function upload(token: string, path: string, bytes: Buffer) {
  const {href} = await call<{href: string}>(token, 'GET', `/resources/upload?${q(path)}&overwrite=false`);
  const r = await fetch(href, {method: 'PUT', body: new Uint8Array(bytes), signal: AbortSignal.timeout(TIMEOUT_MS)});
  if (!r.ok) throw new DiskError(`Яндекс Диск не принял файл: ответ ${r.status}`);
}

interface Meta {
  public_url?: string;
  public_key?: string;
}

/**
 * The editor's address behind a public link: the link itself when it is one,
 * else where the public page sends a visitor or what it names inside.
 */
async function editLink(publicUrl: string): Promise<string> {
  const direct = cleanYandexDocument(publicUrl);
  if (direct) return direct;
  let url = publicUrl;
  for (let i = 0; i < 8; i++) {
    let r: Response;
    try {
      r = await fetch(url, {redirect: 'manual', headers: {'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9'}, signal: AbortSignal.timeout(TIMEOUT_MS)});
    } catch {
      return '';
    }
    const location = r.headers.get('location');
    if (location) {
      const next = new URL(location, url).toString();
      const found = EDIT_LINK.exec(next);
      if (found) return cleanYandexDocument(found[0]) ?? '';
      if (/showcaptcha|passport\.yandex/.test(next)) return '';
      url = next;
      continue;
    }
    const found = EDIT_LINK.exec((await r.text()).replace(/\\\//g, '/'));
    return found ? (cleanYandexDocument(found[0]) ?? '') : '';
  }
  return '';
}

export interface CreatedDoc {
  path: string;
  publicUrl: string;
  editUrl: string;
}

/** A new empty document in the folder, nothing more: no link is opened on it. */
export async function createDocument(token: string, folder: string, name: string): Promise<CreatedDoc> {
  await ensureFolder(token, folder);
  const safe = name.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'taiga';
  const path = `${folder.replace(/\/+$/, '')}/${safe}-${Date.now().toString(36)}.docx`;
  await upload(token, path, emptyDocx(safe));
  return {path, publicUrl: '', editUrl: ''};
}

/** Tries again to learn the editor's address of a published document. */
export async function findEditLink(token: string, path: string): Promise<{publicUrl: string; editUrl: string}> {
  const meta = await call<Meta>(token, 'GET', `/resources?${q(path)}&fields=public_url,public_key`);
  const publicUrl = meta.public_url ?? '';
  return {publicUrl, editUrl: publicUrl ? await editLink(publicUrl) : ''};
}

/** Removes the document for good: its link stops working. */
export async function deleteDocument(token: string, path: string) {
  try {
    await call(token, 'DELETE', `/resources?${q(path)}&permanently=true`);
  } catch (e) {
    if (!(e instanceof DiskError && e.status === 404)) throw e;
  }
}
