/** The panel's API: JSON both ways; a 401 sends the page back to the login. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

export async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: method === 'GET' ? {} : {'Content-Type': 'application/json'},
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && !url.endsWith('/login')) onUnauthorized();
    throw new ApiError(json.error || `Ошибка ${r.status}`, r.status);
  }
  return json as T;
}

export const get = <T>(url: string) => api<T>('GET', url);
export const post = <T>(url: string, body?: unknown) => api<T>('POST', url, body);
export const put = <T>(url: string, body?: unknown) => api<T>('PUT', url, body);
export const patch = <T>(url: string, body?: unknown) => api<T>('PATCH', url, body);
export const del = <T>(url: string) => api<T>('DELETE', url);

/** navigator.clipboard exists only in a secure context (HTTPS or localhost); over plain http fall back to execCommand. */
export async function copy(text: string | Promise<string>): Promise<boolean> {
  // Safari forgets the click across an await, so text still being fetched goes into a ClipboardItem right away.
  if (typeof text !== 'string' && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      const blob = text.then(t => new Blob([t], {type: 'text/plain'}));
      await navigator.clipboard.write([new ClipboardItem({'text/plain': blob})]);
      return true;
    } catch {
      // fall through: a failed fetch rethrows below, otherwise try the plain ways
    }
  }
  const value = await text;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return legacyCopy(value);
  }
}

function legacyCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}

export function ago(at: number): string {
  if (!at) return 'никогда';
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return 'только что';
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
  return new Date(at).toLocaleDateString('ru-RU', {day: 'numeric', month: 'short'});
}
