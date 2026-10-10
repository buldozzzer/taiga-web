// One subscription per Remnawave user, kept in step every few minutes: a new
// user gets one, a removed user loses it, a user not ACTIVE reads nothing. The
// URL is /sub/<the user's shortUuid>, so it follows from the user's Remnawave
// link, and a revoked Remnawave subscription changes it here too.

import type {RemnawaveSyncResult} from '../shared/panel.js';
import {db, settings} from './db.js';
import {log} from './log.js';
import {listUsers} from './remnawave.js';
import {store} from './store.js';

const EVERY_MS = 5 * 60_000;
const PURGE_EVERY_MS = 60 * 60_000;

let running: Promise<RemnawaveSyncResult> | null = null;

export const syncRunning = () => !!running;

async function sync(): Promise<RemnawaveSyncResult> {
  const {remnawaveUrl, remnawaveToken} = settings();
  const at = Date.now();
  let result: RemnawaveSyncResult;
  try {
    if (!remnawaveToken) throw new Error('Remnawave не подключён: добавьте токен в настройках');
    const users = await listUsers(remnawaveUrl, remnawaveToken);
    const changes = store.syncRemnawave(users);
    result = {at, ok: true, error: '', users: users.length, ...changes};
    if (changes.created || changes.removed) {
      log('info', `Remnawave: подписок создано ${changes.created}, удалено ${changes.removed}, изменено ${changes.updated}`);
    }
  } catch (e) {
    result = {at, ok: false, error: (e as Error).message, users: 0, created: 0, updated: 0, removed: 0};
    log('warning', `Синхронизация с Remnawave: ${result.error}`);
  }
  db.update(d => (d.settings.remnawaveSync.last = result));
  return result;
}

/** One sync at a time: a second call waits for the running one. */
export function syncNow(): Promise<RemnawaveSyncResult> {
  running ??= sync().finally(() => (running = null));
  return running;
}

export function startBackground() {
  setInterval(() => {
    if (settings().remnawaveSync.enabled) void syncNow();
  }, EVERY_MS).unref();
  setInterval(() => store.purge(), PURGE_EVERY_MS).unref();
  store.purge();
  if (settings().remnawaveSync.enabled) void syncNow();
}
