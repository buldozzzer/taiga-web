import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {KnownServer, NodeTransport} from '../shared/model.js';
import type {DiskDoc, NodeRecord, PanelSettings, RemnawaveSyncResult, RemnawaveSyncTemplate} from '../shared/panel.js';
import {env} from './env.js';
import {overrides} from './overrides.js';
import {isSealed, open, seal} from './secrets.js';

/** A subscription as db.json kept it before SQLite: read once to move it there. */
export interface LegacySubscription {
  id: string;
  token: string;
  name: string;
  telegram: string;
  site: string;
  message: string;
  nodeIds: string[];
  createdAt: number;
  updatedAt: number;
  readAt: number;
  reads: number;
}

/** Everything the panel keeps but the subscriptions (store.ts). Channel keys live inside the nodes' links: the file is 0600. */
interface Data {
  nodes: NodeRecord[];
  /** Empty once moved to SQLite. */
  subscriptions: LegacySubscription[];
  docs: DiskDoc[];
  /** The secrets stay here: the page gets PanelSettings without them. */
  settings: Omit<PanelSettings, 'sshKey' | 'fromEnv'> & {
    yandexToken: string;
    remnawaveToken: string;
    sshPrivateKey: string;
    sshPassphrase: string;
    /** What every synced subscription gives; updatedAt is when it last changed. */
    /** envHash: the template .env gave at the last start, to see it change. */
    remnawaveSync: RemnawaveSyncTemplate & {updatedAt: number; last: RemnawaveSyncResult | null; envHash: string};
  };
  /** Node wizard: trusted SSH host keys by "host:port". */
  knownHostKeys: Record<string, string>;
  knownServers: KnownServer[];
}

const EMPTY: Data = {
  nodes: [],
  subscriptions: [],
  docs: [],
  settings: {yandexToken: '', yandexUser: '', docsFolder: 'disk:/Taiga', remnawaveUrl: '', remnawaveToken: '', sshPrivateKey: '', sshPassphrase: '', sshUser: 'root',
    remnawaveSync: {enabled: false, name: 'Taiga', telegram: '', site: '', message: '', nodeIds: [], updatedAt: 0, last: null, envHash: ''},
  },
  knownHostKeys: {},
  knownServers: [],
};

const FILE = path.join(env.dataDir, 'db.json');

const SECRET_SETTINGS = ['yandexToken', 'remnawaveToken', 'sshPrivateKey', 'sshPassphrase'] as const;

/**
 * The fields that open something: the tokens and the SSH key, the nodes' links (the channel
 * keys are inside) and the subscriptions' URL secrets. `fn` gets each with its place.
 */
function mapSecrets(d: Data, fn: (where: string, value: string) => string): Data {
  return {
    ...d,
    settings: {...d.settings, ...Object.fromEntries(SECRET_SETTINGS.map(k => [k, fn(`settings.${k}`, d.settings[k])]))},
    nodes: d.nodes.map(n => ({...n, link: fn('node.link', n.link)})),
    subscriptions: d.subscriptions.map(s => ({...s, token: fn('subscription.token', s.token)})),
  };
}

function load(): {data: Data; plain: boolean} {
  let saved: Partial<Data>;
  try {
    saved = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<Data>;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    return {data: structuredClone(EMPTY), plain: false};
  }
  // Settings added later get their defaults in a database from before.
  const stored: Data = {...structuredClone(EMPTY), ...saved, settings: {...EMPTY.settings, ...saved.settings}};
  let plain = false;
  const data = mapSecrets(stored, (where, value) => {
    if (value && !isSealed(value)) plain = true;
    return open(env.dataKey, where, value);
  });
  return {data, plain};
}

const loaded = (() => {
  try {
    return load();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
})();
let data = loaded.data;

/** Writes through a temporary file: a crash never leaves half a database. */
function save() {
  const tmp = `${FILE}.tmp`;
  const sealed = mapSecrets(data, (where, value) => seal(env.dataKey, where, value));
  fs.writeFileSync(tmp, JSON.stringify(sealed, null, 2), {mode: 0o600});
  fs.renameSync(tmp, FILE);
}

// A database from before encryption is sealed on the first start.
if (loaded.plain) save();

// A template changed in .env changes every synced subscription, as an edit on the page does.
{
  const hash = Object.keys(overrides.sync).length ? crypto.createHash('sha256').update(JSON.stringify(overrides.sync)).digest('base64url') : '';
  const t = data.settings.remnawaveSync;
  if (t.envHash !== hash) {
    Object.assign(t, {envHash: hash, updatedAt: Date.now()});
    save();
  }
}

/** Whose Disk YANDEX_TOKEN opens: asked of the Disk once the panel starts. */
let envYandexUser = '';
export const setEnvYandexUser = (user: string) => (envYandexUser = user);

/** The settings in effect: what .env sets, over what the page saved. */
export function settings(): Data['settings'] {
  const s = data.settings;
  const o = overrides.sync;
  const t = s.remnawaveSync;
  // .env names nodes by id or by name; the ones the panel no longer has drop out.
  const nodeIds = o.nodes
    ? [...new Set(o.nodes.map(ref => data.nodes.find(n => n.id === ref) ?? data.nodes.find(n => n.name === ref)).filter(n => !!n).map(n => n.id))]
    : t.nodeIds;
  const {nodes: _n, ...syncFields} = o;
  return {
    ...s,
    ...overrides.settings,
    ...(overrides.settings.yandexToken ? {yandexUser: envYandexUser} : {}),
    remnawaveSync: {...t, ...syncFields, nodeIds},
  };
}

export const newId = () => crypto.randomUUID();
/** A subscription's URL secret: whoever has it reads the keys. */
export const newToken = () => crypto.randomBytes(18).toString('base64url');

export const db = {
  get: () => data,
  update(change: (d: Data) => void) {
    change(data);
    save();
  },
  node: (id: string) => data.nodes.find(n => n.id === id),
  doc: (id: string) => data.docs.find(d => d.id === id),
};

/** A node as the browser sees it: no link, no key. */
export function publicNode(n: NodeRecord) {
  const {link: _link, ...rest} = n;
  return {...rest, transports: n.transports.map((t: NodeTransport) => ({type: t.type, url: t.type === 'cupsonline' ? '' : t.url}))};
}

/** A Yandex document's id from its edit link: docs.yandex.ru and disk.yandex.ru open the same file. */
const documentKey = (url: string) => /\/edit\/d\/([A-Za-z0-9_-]+)/.exec(url)?.[1] ?? '';

/** The node whose Volga goes through this document; one document carries one node. */
export function documentOwner(url: string, exceptNodeId = ''): NodeRecord | undefined {
  const key = documentKey(url);
  if (!key) return undefined;
  return data.nodes.find(n => n.id !== exceptNodeId && n.transports.some(t => t.type === 'vyandex' && documentKey(t.url) === key));
}

/** A document as the browser sees it: its node is read from the nodes, so it never goes stale. */
export function docView(d: DiskDoc): DiskDoc {
  const owner = d.editUrl ? documentOwner(d.editUrl) : undefined;
  return {...d, nodeId: owner?.id ?? '', nodeName: owner?.name ?? ''};
}

/** Refuses a document another node already goes through. */
export function documentTakenError(url: string, exceptNodeId = ''): string {
  const owner = documentOwner(url, exceptNodeId);
  return owner ? `Этот документ уже канал ноды «${owner.name}». У каждой ноды свой документ: создайте новый.` : '';
}
