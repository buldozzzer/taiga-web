// Subscriptions, their reads and daily counts, in SQLite (data/panel.sqlite):
// thousands of them, one per Remnawave user, and every read a row. The rest of
// the panel (settings, nodes, documents) stays small and stays in db.json.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import type {
  RemnawaveUser,
  SubscriptionDay,
  SubscriptionFilter,
  SubscriptionHistory,
  SubscriptionRead,
  SubscriptionRecord,
} from '../shared/panel.js';
import {db, newId, newToken, settings} from './db.js';
import {env} from './env.js';
import {open, seal} from './secrets.js';

/** Reads one by one: a month back. */
export const READS_KEEP_DAYS = 30;
/** Daily counts: a year back. */
const DAYS_KEEP = 400;

const FILE = path.join(env.dataDir, 'panel.sqlite');
const sql = new DatabaseSync(FILE);
// A database made before the umask (or copied in) is closed to others too.
for (const f of [FILE, `${FILE}-wal`, `${FILE}-shm`]) if (fs.existsSync(f)) fs.chmodSync(f, 0o600);
sql.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    token TEXT NOT NULL,
    source TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    telegram TEXT NOT NULL DEFAULT '',
    site TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    node_ids TEXT NOT NULL DEFAULT '[]',
    rw_uuid TEXT UNIQUE,
    rw_username TEXT NOT NULL DEFAULT '',
    rw_status TEXT NOT NULL DEFAULT '',
    rw_expire_at INTEGER NOT NULL DEFAULT 0,
    rw_telegram_id TEXT NOT NULL DEFAULT '',
    rw_email TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    read_at INTEGER NOT NULL DEFAULT 0,
    reads INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS subscriptions_order ON subscriptions (source, name COLLATE NOCASE, rw_username COLLATE NOCASE);
  CREATE TABLE IF NOT EXISTS reads (
    sub_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    at INTEGER NOT NULL,
    day TEXT NOT NULL,
    ip TEXT NOT NULL,
    ua TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS reads_sub_at ON reads (sub_id, at);
  CREATE INDEX IF NOT EXISTS reads_sub_day_ip ON reads (sub_id, day, ip);
  CREATE INDEX IF NOT EXISTS reads_at ON reads (at);
  CREATE TABLE IF NOT EXISTS sessions (
    hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS days (
    sub_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    reads INTEGER NOT NULL,
    ips INTEGER NOT NULL,
    PRIMARY KEY (sub_id, day)
  );
`);

/** Finds a subscription by its URL secret without keeping the secret in the clear. */
const tokenHash = (token: string) => crypto.createHmac('sha256', env.dataKey).update(`subscription.token:${token}`).digest('base64url');

interface Row {
  id: string;
  token: string;
  source: string;
  name: string;
  telegram: string;
  site: string;
  message: string;
  node_ids: string;
  rw_uuid: string | null;
  rw_username: string;
  rw_status: string;
  rw_expire_at: number;
  rw_telegram_id: string;
  rw_email: string;
  created_at: number;
  updated_at: number;
  read_at: number;
  reads: number;
}

/** A synced subscription takes its header and nodes from the template, and changes when it does. */
function record(r: Row): SubscriptionRecord {
  const remnawave: RemnawaveUser | null = r.rw_uuid
    ? {uuid: r.rw_uuid, username: r.rw_username, status: r.rw_status, expireAt: r.rw_expire_at, telegramId: r.rw_telegram_id, email: r.rw_email}
    : null;
  const base = {
    id: r.id,
    token: open(env.dataKey, 'subscription.token', r.token),
    createdAt: r.created_at,
    readAt: r.read_at,
    reads: r.reads,
    remnawave,
  };
  if (r.source === 'remnawave') {
    const t = settings().remnawaveSync;
    return {...base, source: 'remnawave', name: t.name, telegram: t.telegram, site: t.site, message: t.message, nodeIds: t.nodeIds, updatedAt: Math.max(r.updated_at, t.updatedAt)};
  }
  return {...base, source: 'manual', name: r.name, telegram: r.telegram, site: r.site, message: r.message, nodeIds: JSON.parse(r.node_ids), updatedAt: r.updated_at};
}

/** A client gets the nodes from a manual one always, from a synced one while its user is ACTIVE. */
export const isActive = (s: SubscriptionRecord) => s.source === 'manual' || s.remnawave?.status === 'ACTIVE';

function transaction<T>(fn: () => T): T {
  sql.exec('BEGIN');
  try {
    const result = fn();
    sql.exec('COMMIT');
    return result;
  } catch (e) {
    sql.exec('ROLLBACK');
    throw e;
  }
}

const q = {
  byId: sql.prepare('SELECT * FROM subscriptions WHERE id = ?'),
  byHash: sql.prepare('SELECT * FROM subscriptions WHERE token_hash = ?'),
  insert: sql.prepare(`INSERT INTO subscriptions (id, token_hash, token, source, name, telegram, site, message, node_ids,
    rw_uuid, rw_username, rw_status, rw_expire_at, rw_telegram_id, rw_email, created_at, updated_at, read_at, reads)
    VALUES (:id, :token_hash, :token, :source, :name, :telegram, :site, :message, :node_ids,
    :rw_uuid, :rw_username, :rw_status, :rw_expire_at, :rw_telegram_id, :rw_email, :created_at, :updated_at, :read_at, :reads)`),
  update: sql.prepare('UPDATE subscriptions SET name = ?, telegram = ?, site = ?, message = ?, node_ids = ?, updated_at = ? WHERE id = ?'),
  rotate: sql.prepare('UPDATE subscriptions SET token_hash = ?, token = ?, updated_at = ? WHERE id = ?'),
  remove: sql.prepare('DELETE FROM subscriptions WHERE id = ?'),
  withNode: sql.prepare("SELECT id, node_ids FROM subscriptions WHERE source = 'manual' AND node_ids LIKE ?"),
  setNodes: sql.prepare('UPDATE subscriptions SET node_ids = ?, updated_at = ? WHERE id = ?'),
  touch: sql.prepare('UPDATE subscriptions SET updated_at = ? WHERE id = ?'),
  read: sql.prepare('UPDATE subscriptions SET read_at = ?, reads = reads + 1 WHERE id = ?'),
  seenToday: sql.prepare('SELECT 1 FROM reads WHERE sub_id = ? AND day = ? AND ip = ? LIMIT 1'),
  addRead: sql.prepare('INSERT INTO reads (sub_id, at, day, ip, ua) VALUES (?, ?, ?, ?, ?)'),
  addDay: sql.prepare(`INSERT INTO days (sub_id, day, reads, ips) VALUES (?, ?, 1, ?)
    ON CONFLICT (sub_id, day) DO UPDATE SET reads = reads + 1, ips = ips + excluded.ips`),
  recentReads: sql.prepare('SELECT at, ip, ua FROM reads WHERE sub_id = ? ORDER BY at DESC LIMIT ?'),
  recentDays: sql.prepare('SELECT day, reads, ips FROM days WHERE sub_id = ? AND day >= ? ORDER BY day'),
  synced: sql.prepare("SELECT id, token, rw_uuid, rw_username, rw_status, rw_expire_at, rw_telegram_id, rw_email FROM subscriptions WHERE source = 'remnawave'"),
  syncUpdate: sql.prepare(`UPDATE subscriptions SET token_hash = :token_hash, token = :token, rw_username = :rw_username, rw_status = :rw_status,
    rw_expire_at = :rw_expire_at, rw_telegram_id = :rw_telegram_id, rw_email = :rw_email, updated_at = :updated_at WHERE id = :id`),
  purgeReads: sql.prepare('DELETE FROM reads WHERE at < ?'),
  purgeDays: sql.prepare('DELETE FROM days WHERE day < ?'),
  count: sql.prepare('SELECT COUNT(*) AS n FROM subscriptions'),
  sessionGet: sql.prepare('SELECT expires_at FROM sessions WHERE hash = ?'),
  sessionSet: sql.prepare('INSERT INTO sessions (hash, expires_at) VALUES (?, ?) ON CONFLICT (hash) DO UPDATE SET expires_at = excluded.expires_at'),
  sessionDrop: sql.prepare('DELETE FROM sessions WHERE hash = ?'),
  sessionPurge: sql.prepare('DELETE FROM sessions WHERE expires_at < ?'),
};

/** The admin's sessions, by the token's hash: a copy of the database opens none of them. */
const sessionHash = (token: string) => crypto.createHash('sha256').update(token).digest('base64url');

export const sessions = {
  /** When the session ends, 0 for none or an ended one. */
  expires(token: string): number {
    const row = q.sessionGet.get(sessionHash(token)) as {expires_at: number} | undefined;
    return row && row.expires_at > Date.now() ? row.expires_at : 0;
  },
  set: (token: string, expiresAt: number) => void q.sessionSet.run(sessionHash(token), expiresAt),
  drop: (token: string) => void q.sessionDrop.run(sessionHash(token)),
};

const sealToken = (token: string) => ({token_hash: tokenHash(token), token: seal(env.dataKey, 'subscription.token', token)});
const day = (at: number) => new Date(at).toISOString().slice(0, 10);

export interface SubscriptionFields {
  name: string;
  telegram: string;
  site: string;
  message: string;
  nodeIds: string[];
}

export const store = {
  get(id: string): SubscriptionRecord | undefined {
    const r = q.byId.get(id) as Row | undefined;
    return r && record(r);
  },

  byToken(token: string): SubscriptionRecord | undefined {
    const r = q.byHash.get(tokenHash(token)) as Row | undefined;
    return r && record(r);
  },

  list(opts: {search: string; filter: SubscriptionFilter; offset: number; limit: number}) {
    const where: string[] = [];
    const args: string[] = [];
    if (opts.search) {
      const like = `%${opts.search.replace(/[\\%_]/g, c => `\\${c}`)}%`;
      where.push("(name LIKE ? ESCAPE '\\' OR rw_username LIKE ? ESCAPE '\\' OR rw_telegram_id LIKE ? ESCAPE '\\' OR rw_email LIKE ? ESCAPE '\\')");
      args.push(like, like, like, like);
    }
    const searched = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const counts = sql
      .prepare(
        `SELECT COUNT(*) AS "all", COALESCE(SUM(source = 'manual'), 0) AS manual, COALESCE(SUM(source = 'remnawave'), 0) AS remnawave,
         COALESCE(SUM(source = 'remnawave' AND rw_status <> 'ACTIVE'), 0) AS inactive FROM subscriptions ${searched}`,
      )
      .get(...args) as Record<SubscriptionFilter, number>;
    const filter = {
      all: '',
      manual: "source = 'manual'",
      remnawave: "source = 'remnawave'",
      inactive: "source = 'remnawave' AND rw_status <> 'ACTIVE'",
    }[opts.filter];
    if (filter) where.push(filter);
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = sql
      .prepare(`SELECT * FROM subscriptions ${clause} ORDER BY source, name COLLATE NOCASE, rw_username COLLATE NOCASE LIMIT ? OFFSET ?`)
      .all(...args, opts.limit, opts.offset) as unknown as Row[];
    return {items: rows.map(record), total: counts[opts.filter], counts};
  },

  create(fields: SubscriptionFields): SubscriptionRecord {
    const id = newId();
    const now = Date.now();
    q.insert.run({
      id,
      ...sealToken(newToken()),
      source: 'manual',
      name: fields.name,
      telegram: fields.telegram,
      site: fields.site,
      message: fields.message,
      node_ids: JSON.stringify(fields.nodeIds),
      rw_uuid: null,
      rw_username: '',
      rw_status: '',
      rw_expire_at: 0,
      rw_telegram_id: '',
      rw_email: '',
      created_at: now,
      updated_at: now,
      read_at: 0,
      reads: 0,
    });
    return store.get(id)!;
  },

  update(id: string, f: SubscriptionFields) {
    q.update.run(f.name, f.telegram, f.site, f.message, JSON.stringify(f.nodeIds), Date.now(), id);
    return store.get(id)!;
  },

  rotate(id: string) {
    const {token_hash, token} = sealToken(newToken());
    q.rotate.run(token_hash, token, Date.now(), id);
    return store.get(id)!;
  },

  remove: (id: string) => void q.remove.run(id),

  /** A node renamed: the subscriptions with it change, so clients take the new link. */
  touchNode(nodeId: string) {
    const now = Date.now();
    for (const r of q.withNode.all(`%"${nodeId}"%`) as {id: string}[]) q.touch.run(now, r.id);
  },

  /** A node gone from the panel goes from every subscription. */
  dropNode(nodeId: string) {
    const now = Date.now();
    transaction(() => {
      for (const r of q.withNode.all(`%"${nodeId}"%`) as {id: string; node_ids: string}[]) {
        q.setNodes.run(JSON.stringify((JSON.parse(r.node_ids) as string[]).filter(id => id !== nodeId)), now, r.id);
      }
    });
  },

  /** A client's read: the subscription's counters, the read itself and the day's counts. */
  recordRead(id: string, ip: string, ua: string) {
    const at = Date.now();
    const d = day(at);
    transaction(() => {
      const newIp = !q.seenToday.get(id, d, ip);
      q.read.run(at, id);
      q.addRead.run(id, at, d, ip, ua.slice(0, 300));
      q.addDay.run(id, d, newIp ? 1 : 0);
    });
  },

  history(id: string): SubscriptionHistory {
    const since = day(Date.now() - 89 * 86400_000);
    return {
      reads: q.recentReads.all(id, 200) as unknown as SubscriptionRead[],
      days: q.recentDays.all(id, since) as unknown as SubscriptionDay[],
    };
  },

  /** The users from Remnawave, as they are now: new ones get a subscription, gone ones lose it. */
  syncRemnawave(users: (RemnawaveUser & {shortUuid: string})[]) {
    const now = Date.now();
    const result = {created: 0, updated: 0, removed: 0};
    transaction(() => {
      const existing = new Map((q.synced.all() as unknown as Row[]).map(r => [r.rw_uuid!, r]));
      for (const u of users) {
        if (!u.uuid || !u.shortUuid) continue;
        const row = existing.get(u.uuid);
        existing.delete(u.uuid);
        const fields = {rw_username: u.username, rw_status: u.status, rw_expire_at: u.expireAt, rw_telegram_id: u.telegramId, rw_email: u.email};
        if (!row) {
          q.insert.run({
            id: newId(),
            ...sealToken(u.shortUuid),
            source: 'remnawave',
            name: '',
            telegram: '',
            site: '',
            message: '',
            node_ids: '[]',
            rw_uuid: u.uuid,
            ...fields,
            created_at: now,
            updated_at: now,
            read_at: 0,
            reads: 0,
          });
          result.created++;
          continue;
        }
        const tokenChanged = open(env.dataKey, 'subscription.token', row.token) !== u.shortUuid;
        const changed = tokenChanged || (Object.keys(fields) as (keyof typeof fields)[]).some(k => row[k] !== fields[k]);
        if (!changed) continue;
        q.syncUpdate.run({id: row.id, ...(tokenChanged ? sealToken(u.shortUuid) : {token_hash: tokenHash(u.shortUuid), token: row.token}), ...fields, updated_at: now});
        result.updated++;
      }
      for (const gone of existing.values()) {
        q.remove.run(gone.id);
        result.removed++;
      }
    });
    return result;
  },

  /** Drops reads past a month and daily counts past a year. */
  purge() {
    q.purgeReads.run(Date.now() - READS_KEEP_DAYS * 86400_000);
    q.purgeDays.run(day(Date.now() - DAYS_KEEP * 86400_000));
    q.sessionPurge.run(Date.now());
  },

  /** The subscriptions db.json had before SQLite: moved once, as they were. */
  importFromJson(subs: {id: string; token: string; name: string; telegram: string; site: string; message: string; nodeIds: string[]; createdAt: number; updatedAt: number; readAt: number; reads: number}[]) {
    transaction(() => {
      for (const s of subs) {
        if (q.byId.get(s.id)) continue;
        q.insert.run({
          id: s.id,
          ...sealToken(s.token),
          source: 'manual',
          name: s.name,
          telegram: s.telegram,
          site: s.site,
          message: s.message,
          node_ids: JSON.stringify(s.nodeIds),
          rw_uuid: null,
          rw_username: '',
          rw_status: '',
          rw_expire_at: 0,
          rw_telegram_id: '',
          rw_email: '',
          created_at: s.createdAt,
          updated_at: s.updatedAt,
          read_at: s.readAt,
          reads: s.reads,
        });
      }
    });
  },

  count: () => (q.count.get() as {n: number}).n,
};

// Subscriptions from db.json (before SQLite) move here on the first start.
const legacy = db.get().subscriptions;
if (legacy.length) {
  store.importFromJson(legacy);
  db.update(d => (d.subscriptions = []));
}
