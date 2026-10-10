// The Remnawave panel's REST API: only the node list, read with an API token
// from its Settings → API Tokens.

const TIMEOUT_MS = 15_000;

export class RemnawaveError extends Error {}

/** A node as Remnawave's GET /api/nodes gives it; only what the panel reads. */
interface ApiNode {
  uuid: string;
  name: string;
  address: string;
  countryCode?: string;
  isConnected?: boolean;
  isDisabled?: boolean;
}

export interface Node {
  uuid: string;
  name: string;
  address: string;
  countryCode: string;
  connected: boolean;
  disabled: boolean;
}

/** The panel's address as typed: https, or http on a private address; no trailing slash. */
export function panelUrl(text: string): string {
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text.trim()) ? text.trim() : `https://${text.trim()}`);
  } catch {
    throw new RemnawaveError('Адрес панели вида https://panel.example.com');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new RemnawaveError('Адрес панели вида https://panel.example.com');
  return url.toString().replace(/\/+$/, '');
}

/** A GET on Remnawave's API: its `response`, or what it says when it refuses. */
async function call(base: string, token: string, pathAndQuery: string): Promise<unknown> {
  const url = `${base}${pathAndQuery}`;
  // Behind its reverse proxy Remnawave expects these; reached directly over http (a docker network,
  // localhost) it refuses without them.
  const proxied: Record<string, string> = url.startsWith('http:') ? {'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '127.0.0.1'} : {};
  let r: Response;
  try {
    r = await fetch(url, {headers: {Authorization: `Bearer ${token}`, Accept: 'application/json', ...proxied}, signal: AbortSignal.timeout(TIMEOUT_MS)});
  } catch (e) {
    const reason = (e as Error).name === 'TimeoutError' ? 'не ответила за 15 секунд' : (e as Error).message;
    throw new RemnawaveError(`Панель Remnawave недоступна: ${reason}`);
  }
  const text = await r.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new RemnawaveError(`По адресу ${new URL(base).host} не API Remnawave: проверьте адрес панели`);
  }
  if (r.status === 401 || r.status === 403) throw new RemnawaveError('Remnawave не принял токен: создайте новый в «Настройки → API-токены»');
  if (!r.ok) throw new RemnawaveError(`Remnawave ответил ${r.status}: ${(json as {message?: string})?.message ?? 'ошибка'}`);
  return (json as {response?: unknown})?.response ?? json;
}

interface ApiUser {
  uuid: string;
  shortUuid: string;
  username: string;
  status?: string;
  expireAt?: string | null;
  telegramId?: number | string | null;
  email?: string | null;
}

export interface User {
  uuid: string;
  shortUuid: string;
  username: string;
  status: string;
  expireAt: number;
  telegramId: string;
  email: string;
}

const PAGE = 500;

/** Every user, page by page (GET /api/users?start=&size=). */
export async function listUsers(base: string, token: string): Promise<User[]> {
  const users: User[] = [];
  for (let start = 0; ; start += PAGE) {
    const page = (await call(base, token, `/api/users?start=${start}&size=${PAGE}`)) as {users?: ApiUser[]; total?: number} | ApiUser[];
    const list = Array.isArray(page) ? page : page?.users;
    if (!Array.isArray(list)) throw new RemnawaveError('Remnawave вернул не список пользователей: проверьте адрес панели');
    for (const u of list) {
      users.push({
        uuid: String(u.uuid ?? ''),
        shortUuid: String(u.shortUuid ?? ''),
        username: String(u.username ?? ''),
        status: String(u.status ?? ''),
        expireAt: u.expireAt ? Date.parse(u.expireAt) || 0 : 0,
        telegramId: u.telegramId == null ? '' : String(u.telegramId),
        email: u.email ?? '',
      });
    }
    const total = Array.isArray(page) ? list.length : (page.total ?? 0);
    // An answer without a total is one page: the whole list.
    if (list.length < PAGE || users.length >= total || Array.isArray(page)) break;
  }
  return users;
}

export async function listNodes(base: string, token: string): Promise<Node[]> {
  const list = await call(base, token, '/api/nodes');
  if (!Array.isArray(list)) throw new RemnawaveError('Remnawave вернул не список нод: проверьте адрес панели');
  return (list as ApiNode[]).map(n => ({
    uuid: String(n.uuid ?? ''),
    name: String(n.name ?? ''),
    address: String(n.address ?? ''),
    countryCode: String(n.countryCode ?? ''),
    connected: !!n.isConnected,
    disabled: !!n.isDisabled,
  }));
}
