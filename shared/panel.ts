// What the panel's server and pages share, besides the client's own model.ts.

import type {NodeTransport, TransportType} from './model.js';

/** A node the panel knows: installed by the wizard or added from a taiga:// link. */
export interface NodeRecord {
  id: string;
  name: string;
  /** The server's address; "" for a node added from a link without direct. */
  host: string;
  /** The channel's direct port. */
  port: number;
  /** The channel's name on the server; "" for an added link. */
  channel: string;
  transports: NodeTransport[];
  /** The taiga:// link with the key: kept on the server, given out only by subscriptions and on request. */
  link: string;
  source: 'wizard' | 'link';
  /** The command that removes the node on the server, "" when there is none. */
  uninstall: string;
  createdAt: number;
  check: NodeCheck | null;
}

/** The last check through the node: the panel's own core went through it. */
export interface NodeCheck {
  at: number;
  ok: boolean;
  exitIp: string;
  ms: number;
  via: string[];
  error: string;
}

export type NodeView = Omit<NodeRecord, 'link'>;

/** manual: made in the panel; remnawave: one per Remnawave user, kept by the sync. */
export type SubscriptionSource = 'manual' | 'remnawave';

/** The Remnawave user a synced subscription belongs to. */
export interface RemnawaveUser {
  uuid: string;
  username: string;
  /** ACTIVE, DISABLED, LIMITED, EXPIRED: only ACTIVE reads. */
  status: string;
  /** 0 for never. */
  expireAt: number;
  telegramId: string;
  email: string;
}

/** A list of nodes behind a secret URL that the Taiga client reads. */
export interface SubscriptionRecord {
  id: string;
  /** The URL's secret part: /sub/<token>; a synced one's is the user's Remnawave shortUuid. */
  token: string;
  source: SubscriptionSource;
  /** A synced subscription's header and nodes are the sync template's. */
  name: string;
  telegram: string;
  site: string;
  message: string;
  nodeIds: string[];
  remnawave: RemnawaveUser | null;
  createdAt: number;
  updatedAt: number;
  /** When a client last read it, 0 never. */
  readAt: number;
  reads: number;
}

export interface SubscriptionView extends SubscriptionRecord {
  url: string;
  /** Whether a client gets the nodes: a synced one only while its user is ACTIVE. */
  active: boolean;
}

export type SubscriptionFilter = 'all' | 'manual' | 'remnawave' | 'inactive';

export interface SubscriptionPage {
  items: SubscriptionView[];
  /** Matching the search and the filter. */
  total: number;
  counts: Record<SubscriptionFilter, number>;
}

/** One read by a client, kept 30 days. */
export interface SubscriptionRead {
  at: number;
  ip: string;
  ua: string;
}

/** A day's reads (UTC), kept after the reads themselves are gone. */
export interface SubscriptionDay {
  day: string;
  reads: number;
  ips: number;
}

export interface SubscriptionHistory {
  reads: SubscriptionRead[];
  days: SubscriptionDay[];
}

/** What every synced subscription gives, and how the last sync went. */
export interface RemnawaveSyncTemplate {
  enabled: boolean;
  name: string;
  telegram: string;
  site: string;
  message: string;
  nodeIds: string[];
}

export interface RemnawaveSyncResult {
  at: number;
  ok: boolean;
  error: string;
  users: number;
  created: number;
  updated: number;
  removed: number;
}

export interface RemnawaveSyncView extends RemnawaveSyncTemplate {
  last: RemnawaveSyncResult | null;
  running: boolean;
  /** Template fields .env sets, and by which variable. */
  fromEnv: Partial<Record<keyof RemnawaveSyncTemplate, string>>;
}

/** A document on the owner's Yandex Disk, open for editing by anyone with the link. */
export interface DiskDoc {
  id: string;
  name: string;
  /** disk:/Taiga/… */
  path: string;
  /** https://docs.yandex.ru/edit/d/… or "" while it is not known. */
  editUrl: string;
  /** What the Disk gave on publishing. */
  publicUrl: string;
  createdAt: number;
  /** The core's check: can an anonymous visitor edit it. */
  check: {at: number; status: 'ok' | 'captcha' | 'fail'; text: string} | null;
  /** The node going through it, "" when free: worked out from the nodes' Volga links, one node per document. */
  nodeId: string;
  nodeName: string;
}

export interface PanelSettings {
  /** Whose Disk the token opens; "" without a token. */
  yandexUser: string;
  docsFolder: string;
  /** The Remnawave panel the node list comes from, "" for none; its API token never leaves the server. */
  remnawaveUrl: string;
  /** The saved SSH key for the nodes; the key itself never leaves the server. */
  sshKey: SshKeyInfo | null;
  /** The login the wizard offers with the saved key. */
  sshUser: string;
  /** Settings .env sets, and by which variable: the page shows them locked. */
  fromEnv: Partial<Record<'yandexToken' | 'docsFolder' | 'remnawaveUrl' | 'remnawaveToken' | 'sshPrivateKey' | 'sshPassphrase' | 'sshUser', string>>;
}

/** What the page may know about the saved SSH key. */
export interface SshKeyInfo {
  /** ed25519, rsa, ecdsa… */
  type: string;
  /** "SHA256:…" as ssh-keygen -l prints it, "" when it cannot be read without the passphrase. */
  fingerprint: string;
  encrypted: boolean;
}

/** A node of the Remnawave panel, and the Taiga node on the same server if there is one. */
export interface RemnawaveNode {
  uuid: string;
  name: string;
  address: string;
  /** ISO 3166 alpha-2, "XX" when Remnawave does not know. */
  countryCode: string;
  connected: boolean;
  disabled: boolean;
  taigaNodeId: string;
  taigaNodeName: string;
}

/** A country's flag emoji from its alpha-2 code ("" for none or Remnawave's "XX"). */
export function countryFlag(code: string): string {
  const c = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c) || c === 'XX') return '';
  return String.fromCodePoint(...[...c].map(ch => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

export interface PanelStatus {
  core: {path: string; ok: boolean; version: string};
  yandex: {connected: boolean; user: string};
  remnawave: {connected: boolean; url: string};
  /** A saved SSH key the wizard can log in with. */
  sshKey: boolean;
  publicUrl: string;
}

// ---- the node wizard, as the page sees it ----

export type WizardStep = 'server' | 'transports' | 'plan' | 'verify' | 'done';

export interface WizardView {
  active: boolean;
  step: WizardStep;
  busy: string | null;
  error: string | null;
  notice: string | null;
  host: string;
  port: string;
  user: string;
  hostKeyPrompt: {fingerprint: string; mismatch: boolean} | null;
  probe: {arch?: string; os?: string; systemd?: boolean; sudo?: string; core?: string; autoupdate?: boolean; channels?: string[]} | null;
  channel: string;
  name: string;
  useVolga: boolean;
  useMailru: boolean;
  useCups: boolean;
  documentUrl: string;
  documentWarning: string;
  docId: string;
  mailruInput: string;
  plan: {channel?: string; port: number; arch?: string; core?: string; actions?: string[]; untouched?: string[]} | null;
  needsSudoPassword: boolean;
  autoUpdate: boolean;
  transports: TransportType[];
  installed: boolean;
  uninstallCommand: string;
  uninstallError: string;
  verifiedIp: string;
  verifyMs: number;
  verifyVia: string[];
  verifyFailed: string | null;
  savedNodeId: string;
  knownServers: {host: string; port: number; user: string}[];
  /** The saved key, as the wizard offers it ("ed25519 SHA256:…"), "" without one. */
  savedKey: string;
  savedKeyUser: string;
}
