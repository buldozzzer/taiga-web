// The data the app and the main process share. Mirrors OpenFluxClientShared's
// model (Profile, TransportType, AppSettings, ConnectionState), so profiles
// and links mean the same as on the OpenFlux clients (taiga:// here, openflux:// for the core).

export type ValueKind = 'documentUrl' | 'address' | 'token';

export type TransportType =
  | 'vyandex'
  | 'yandex'
  | 'boards'
  | 'mailru'
  | 'cupsonline'
  | 'oneme'
  | 'direct';

export interface TransportInfo {
  label: string;
  shortLabel: string;
  kind: ValueKind;
  valueHint: string;
}

export const TRANSPORTS: Record<TransportType, TransportInfo> = {
  vyandex: {label: 'Yandex Docs (Volga)', shortLabel: 'Volga', kind: 'documentUrl', valueHint: 'https://docs.yandex.ru/edit/d/…'},
  yandex: {label: 'Yandex Docs', shortLabel: 'Yandex', kind: 'documentUrl', valueHint: 'https://disk.yandex.ru/i/…'},
  boards: {label: 'Yandex Board', shortLabel: 'Board', kind: 'documentUrl', valueHint: 'https://…/board/…'},
  mailru: {label: 'Mail.ru Docs', shortLabel: 'Mail.ru', kind: 'documentUrl', valueHint: 'https://cloud.mail.ru/public/…'},
  cupsonline: {label: 'Cups.online', shortLabel: 'Cups', kind: 'documentUrl', valueHint: 'Код комнат от ноды'},
  oneme: {label: 'MAX (OneMe)', shortLabel: 'MAX', kind: 'token', valueHint: 'Токен MAX Web'},
  direct: {label: 'Direct (TCP до ноды)', shortLabel: 'Direct', kind: 'address', valueHint: 'host:port'},
};

export const TRANSPORT_TYPES = Object.keys(TRANSPORTS) as TransportType[];

/** Whether a taiga:// link can carry it (MAX tokens are per account). */
export const isShareable = (t: TransportType) => t !== 'oneme';
/** Direct needs an authenticated session: it has no document to meet in. */
export const isSessionOnly = (t: TransportType) => t === 'direct';

/** A Session carrier's name as the core reports it ("boards-2") for the UI: "Board 2". */
export function carrierLabel(name: string): string {
  const [base, n] = name.split('-', 2);
  const info = TRANSPORTS[base as TransportType];
  if (!info) return name;
  return n ? `${info.shortLabel} ${n}` : info.shortLabel;
}

export type Codec = 'batched' | 'legacy';
export const CODECS: Record<Codec, string> = {
  batched: 'Быстрый (zstd)',
  legacy: 'Совместимый (LZ4)',
};

export type ProfileSource = 'manual' | 'link' | 'qr' | 'node' | 'subscription';
export const PROFILE_SOURCES: Record<ProfileSource, string> = {
  manual: 'Вручную',
  link: 'Ссылка taiga://',
  qr: 'QR-код',
  node: 'Своя нода',
  subscription: 'Подписка',
};

export interface ExtraTransport {
  type: TransportType;
  value: string;
  uid: string;
  priority: number;
}

/** A saved connection: which exit to reach and how. */
export interface Profile {
  id: string;
  name: string;
  transport: TransportType;
  /** Document URL, host:port for direct, MAX Web token for oneme. */
  value: string;
  /** MAX user id (oneme only). */
  uid: string;
  secret: string;
  codec: Codec;
  /** Session mode (the core's --negotiate): several carriers with failover. */
  session: boolean;
  priority: number;
  /** The exit's encryption context from an imported link ("" derives it). */
  context: string;
  extras: ExtraTransport[];
  source: ProfileSource;
  createdAt: number;
  /** The mode without a server: a PHP node on a web host over cups.online or Mail.ru. */
  stream: boolean;
  /** The subscription the profile came from ("" for none) and its name there, which an update matches. */
  subscriptionId: string;
  subscriptionKey: string;
}

export const MIN_SECRET = 16;

export function newProfile(id: string, now: number): Profile {
  return {
    id,
    name: '',
    transport: 'vyandex',
    value: '',
    uid: '',
    secret: '',
    codec: 'batched',
    session: false,
    priority: 100,
    context: '',
    extras: [],
    source: 'manual',
    createdAt: now,
    stream: false,
    subscriptionId: '',
    subscriptionKey: '',
  };
}

/** Every carrier of the profile, main first. */
export function carriers(p: Profile): ExtraTransport[] {
  return [{type: p.transport, value: p.value, uid: p.uid, priority: p.priority}, ...(p.session ? p.extras : [])];
}

export function profileSummary(p: Profile): string {
  if (p.stream) return `Без сервера, ${TRANSPORTS[p.transport].shortLabel}`;
  if (p.session) return carriers(p).map(c => TRANSPORTS[c.type].shortLabel).join(' + ');
  return TRANSPORTS[p.transport].label;
}

const CUPS_ROOM = /^https:\/\/interview\.cups\.online\/live-coding\/\?room=[A-Za-z0-9_-]+/;
const MAILRU_PUBLIC = /^https:\/\/cloud\.mail\.ru\/public\/\S+/;

function streamProblem(p: Profile): string | null {
  const v = p.value.trim();
  if (p.session || p.secret) return 'В режиме без сервера нет ключа и режима Session';
  if (p.transport === 'cupsonline') {
    return CUPS_ROOM.test(v) ? null : 'Нужен адрес комнаты cups.online (https://interview.cups.online/live-coding/?room=…)';
  }
  if (p.transport === 'mailru') {
    return MAILRU_PUBLIC.test(v) ? null : 'Нужна публичная ссылка на документ Mail.ru (https://cloud.mail.ru/public/…)';
  }
  return 'Режим без сервера работает через cups.online или Mail.ru';
}

export function carrierProblem(c: ExtraTransport): string | null {
  const value = c.value.trim();
  switch (TRANSPORTS[c.type].kind) {
    case 'documentUrl':
      // Cups.online with no rooms is valid: the node makes its own.
      if (c.type === 'cupsonline') return null;
      if (!value) return 'нужна ссылка';
      if (!value.startsWith('https://')) return 'ссылка должна начинаться с https://';
      return null;
    case 'address':
      return /^[^\s:]+:\d{1,5}$/.test(value) ? null : 'нужен адрес host:port';
    case 'token':
      if (!value) return 'нужен токен MAX';
      if (!c.uid.trim()) return 'нужен ID пользователя MAX';
      return null;
  }
}

/** Problems that keep the profile from connecting, empty when it can. */
export function profileProblems(p: Profile): string[] {
  const out: string[] = [];
  if (!p.name.trim()) out.push('Укажите название');
  if (p.stream) {
    const s = streamProblem(p);
    if (s) out.push(s);
    return out;
  }
  carriers(p).forEach((c, i) => {
    const where = i === 0 ? 'Основной транспорт' : `Транспорт ${i + 1}`;
    const problem = carrierProblem(c);
    if (problem) out.push(`${where}: ${problem}`);
  });
  if (p.session && p.secret.length < MIN_SECRET) out.push(`Для режима Session нужен ключ не короче ${MIN_SECRET} символов`);
  if (!p.session && p.secret && p.secret.length < MIN_SECRET) out.push(`Ключ должен быть не короче ${MIN_SECRET} символов`);
  if (!p.session && isSessionOnly(p.transport)) out.push(`${TRANSPORTS[p.transport].label} работает только в режиме Session`);
  return out;
}

export interface SessionSpec {
  name: string;
  type: TransportType;
  value: string;
  uid: string;
  priority: number;
}

/** The transports as the core's Session names them: type, then type-2, type-3 for repeats. */
export function sessionSpecs(p: Profile): SessionSpec[] {
  const seen = new Map<TransportType, number>();
  return carriers(p).map(c => {
    const n = (seen.get(c.type) ?? 0) + 1;
    seen.set(c.type, n);
    return {
      name: n === 1 ? c.type : `${c.type}-${n}`,
      type: c.type,
      value: c.value.trim(),
      uid: c.uid.trim(),
      priority: c.priority,
    };
  });
}

// ---- taiga:// links: the JSON shape of the core's share.Config ----

export interface ShareTransport {
  type: string;
  name?: string;
  url?: string;
  priority?: number;
  dial?: string;
}

export interface ShareConfig {
  name?: string;
  negotiate?: boolean;
  codec?: string;
  secret?: string;
  context?: string;
  /** "" is the classic tunnel; "stream" is the mode without a server. */
  mode?: string;
  transports: ShareTransport[];
}

export const LINK_PREFIX = 'taiga://v1/';
/** What the core reads and writes: the same link under the upstream scheme. */
const CORE_SCHEME = 'openflux://';
const SCHEME = /^(taiga|openflux):\/\//i;

/** Whether the text is a profile link: taiga://, or openflux:// from the other clients. */
export function isLink(text: string): boolean {
  return SCHEME.test(text.trim());
}

/** The link as the core reads it. */
export function toCoreLink(link: string): string {
  return link.trim().replace(SCHEME, CORE_SCHEME);
}

/** A link from the core, as this app shows and shares it. */
export function fromCoreLink(link: string): string {
  return link.trim().replace(SCHEME, 'taiga://');
}

/** The config the core turns into a link; throws with why when it cannot be shared. */
export function toShare(p: Profile): ShareConfig {
  if (p.stream) {
    const s = streamProblem(p);
    if (s) throw new Error(s);
    return {name: p.name, mode: 'stream', transports: [{type: p.transport, url: p.value.trim()}]};
  }
  if (!isShareable(p.transport)) {
    throw new Error(`${TRANSPORTS[p.transport].label} нельзя передать ссылкой: токен привязан к аккаунту`);
  }
  const transports = carriers(p)
    .filter(c => isShareable(c.type))
    .map(c => ({
      type: c.type,
      url: c.type === 'direct' ? '' : c.value.trim(),
      dial: c.type === 'direct' ? c.value.trim() : '',
      priority: c.priority,
    }));
  return {
    name: p.name,
    negotiate: p.session,
    codec: p.codec,
    secret: p.secret,
    context: p.context,
    transports,
  };
}

/** A profile from a link: the highest-priority non-direct transport is the main one. */
export function fromShare(config: ShareConfig, id: string, now: number, source: ProfileSource): Profile {
  const base = newProfile(id, now);
  const known = (t: string): TransportType => {
    if (!(t in TRANSPORTS)) throw new Error(`Неизвестный транспорт ${t}`);
    return t as TransportType;
  };
  if (config.mode === 'stream') {
    if (config.transports.length !== 1) throw new Error('В режиме без сервера нужен ровно один транспорт');
    const only = config.transports[0];
    return {...base, name: config.name || 'Без сервера', transport: known(only.type), value: only.url ?? '', stream: true, source};
  }
  const sorted = [...config.transports].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  if (sorted.length === 0) throw new Error('В ссылке нет транспортов');
  const main = sorted.find(t => t.type !== 'direct') ?? sorted[0];
  const value = (t: ShareTransport) => (t.type === 'direct' ? t.dial ?? '' : t.url ?? '');
  return {
    ...base,
    name: config.name || 'Taiga',
    transport: known(main.type),
    value: value(main),
    secret: config.secret ?? '',
    codec: config.codec === 'legacy' ? 'legacy' : 'batched',
    session: !!config.negotiate,
    // A lone carrier's link carries no priority: a new profile's.
    priority: main.priority || 100,
    context: config.negotiate ? config.context ?? '' : '',
    extras: sorted
      .filter(t => t !== main)
      .map(t => ({type: known(t.type), value: value(t), uid: '', priority: t.priority ?? 50})),
    source,
  };
}

/** What the user reads for each reason the core gives about a link (share.Code*). */
export function linkErrorText(code: string, param = '', detail = ''): string {
  const label = (t: string) => TRANSPORTS[t as TransportType]?.label ?? t;
  switch (code) {
    case 'not_link': return 'Это не ссылка taiga://';
    case 'unsupported_version': return 'Неподдерживаемая версия ссылки, обновите Taiga';
    case 'case_changed': return 'Буквы в ссылке поменяли регистр по дороге: скопируйте её ещё раз';
    case 'damaged': return 'Ссылка повреждена или обрезана: скопируйте её целиком ещё раз';
    case 'too_large': return 'Ссылка слишком большая';
    case 'bad_payload': return 'Ссылка повреждена: внутри не настройки Taiga';
    case 'bad_config': return 'Не удалось собрать ссылку из профиля';
    case 'no_transports': return 'В ссылке нет транспортов';
    case 'several_need_session': return 'Несколько транспортов требуют режима Session';
    case 'session_secret': return `Для режима Session нужен ключ не короче ${param} символов`;
    case 'short_secret': return `Ключ должен быть не короче ${param} символов`;
    case 'unknown_codec': return `Неизвестный кодек «${param}»`;
    case 'not_shareable': return `${label(param)} нельзя передать ссылкой: токен привязан к аккаунту`;
    case 'unknown_transport': return `Неизвестный транспорт «${param}»: возможно, нужно обновить Taiga`;
    case 'direct_no_dial': return 'У direct нет адреса ноды';
    case 'direct_needs_session': return 'Direct работает только в режиме Session';
    case 'unknown_mode': return `Ссылка для режима «${param}», которого это приложение не знает: обновите Taiga`;
    case 'stream_transport': return `Режим без сервера работает через cups.online или Mail.ru, а не через ${label(param)}`;
    case 'stream_one_transport': return 'В режиме без сервера нужен ровно один транспорт';
    case 'stream_plain_only': return 'В режиме без сервера нет ключа и режима Session';
    default: return detail ? `Не удалось обработать ссылку: ${detail}` : 'Не удалось обработать ссылку';
  }
}

// ---- settings ----

export type ConnectionMode = 'client' | 'exit';
export type CoreSource = 'bundled' | 'custom';

export interface SavedSystemProxy {
  enabled: boolean;
  server: string;
  override: string;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface AppSettings {
  mode: ConnectionMode;
  socksPort: number;
  /** Point Windows at the core's HTTP proxy while connected. */
  systemProxy: boolean;
  /** Client: all traffic through Wintun (the core's --inbound=tun). Needs administrator rights. */
  fullTunnel: boolean;
  autoConnect: boolean;
  selectedProfileId: string | null;
  coreSource: CoreSource;
  customCorePath: string;
  /** The core's --debug level: 0 off … 3 hexdumps. */
  debugLevel: number;
  logAutoScroll: boolean;
  /** Hide document URLs and keys in the log view. */
  maskSensitive: boolean;
  closeToTray: boolean;
  /** Exit mode: address clients dial for direct ("" = the core's guess). */
  exitShareHost: string;
  /** Exit mode: TCP port for the direct transport. */
  exitDirectPort: number;
  /** Set while Taiga has changed the Windows proxy; restored on exit or next start. */
  savedSystemProxy: SavedSystemProxy | null;
  window: WindowBounds | null;
  /** Node wizard: trusted SSH host keys by "host:port". */
  knownHostKeys: Record<string, string>;
  /** Node wizard: servers used before, newest first. No passwords. */
  knownServers: KnownServer[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  mode: 'client',
  socksPort: 1080,
  systemProxy: true,
  fullTunnel: false,
  autoConnect: false,
  selectedProfileId: null,
  coreSource: 'bundled',
  customCorePath: '',
  debugLevel: 0,
  logAutoScroll: true,
  maskSensitive: true,
  closeToTray: true,
  exitShareHost: '',
  exitDirectPort: 8445,
  savedSystemProxy: null,
  window: null,
  knownHostKeys: {},
  knownServers: [],
};

// ---- connection ----

export type ConnectionState =
  | {kind: 'idle'}
  | {kind: 'connecting'; profile: Profile; mode: ConnectionMode; since: number}
  | {kind: 'connected'; profile: Profile; mode: ConnectionMode; since: number}
  | {kind: 'reconnecting'; profile: Profile; mode: ConnectionMode; since: number}
  | {kind: 'disconnecting'; profile: Profile}
  | {kind: 'failed'; profile: Profile | null; message: string};

export const isActive = (s: ConnectionState) =>
  s.kind === 'connecting' || s.kind === 'connected' || s.kind === 'reconnecting';

export const stateProfile = (s: ConnectionState): Profile | null => (s.kind === 'idle' ? null : s.profile);

export interface TrafficStats {
  upBytesPerSec: number;
  downBytesPerSec: number;
  totalUp: number;
  totalDown: number;
  /** Every carrier data is spread over. */
  activeTransports: string[];
  /** Whether the core reports its status over IPC. */
  live: boolean;
}

export const EMPTY_TRAFFIC: TrafficStats = {
  upBytesPerSec: 0,
  downBytesPerSec: 0,
  totalUp: 0,
  totalDown: 0,
  activeTransports: [],
  live: false,
};

/** One point of the speed chart: a second of the core's status. */
export interface SpeedSample {
  t: number;
  up: number;
  down: number;
}

export type ExitAddress =
  | {kind: 'unknown'}
  | {kind: 'checking'}
  | {kind: 'known'; ip: string}
  | {kind: 'unavailable'; reason: string};

export interface CaptchaPrompt {
  url: string;
  reason: string;
  /** The check belongs to the exit node: the browser goes through its address. */
  remote: boolean;
  error: string;
  busy: boolean;
  /** Checks waiting, this one included. */
  total: number;
}

export type LogLevel = 'info' | 'success' | 'warning' | 'error' | 'debug';

export interface LogLine {
  id: number;
  time: number;
  text: string;
  level: LogLevel;
}

/** Everything the window shows about the connection, pushed by the main process. */
export interface ConnectionSnapshot {
  state: ConnectionState;
  traffic: TrafficStats;
  exitAddress: ExitAddress;
  captcha: CaptchaPrompt | null;
  exitShareLink: string | null;
  socksAddress: string | null;
  httpAddress: string | null;
}

export interface PlatformInfo {
  os: 'windows' | 'macos' | 'linux';
  appVersion: string;
  coreVersion: string;
  coreFound: boolean;
  systemProxySupported: boolean;
  fullTunnelSupported: boolean;
  /** How the full tunnel gets administrator rights, in the user's words; null when nothing is asked. */
  fullTunnelPrompt: string | null;
}

// ---- formatting ----

function oneDecimal(v: number): string {
  const tenths = Math.round(v * 10);
  return tenths % 10 === 0 ? `${tenths / 10}` : `${Math.floor(tenths / 10)},${tenths % 10}`;
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${Math.round(value)} Б`;
  if (value < 1024 * 1024) return `${oneDecimal(value / 1024)} КБ`;
  if (value < 1024 ** 3) return `${oneDecimal(value / 1024 ** 2)} МБ`;
  return `${oneDecimal(value / 1024 ** 3)} ГБ`;
}

export const formatSpeed = (bps: number) => `${formatBytes(bps)}/с`;

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

/** Hides document addresses and keys, as the other clients' logs do. */
export function redact(text: string): string {
  return text
    .replace(/(taiga|openflux):\/\/v1\/[A-Za-z0-9_-]+/g, '$1://v1/[скрыто]')
    .replace(/https?:\/\/(docs|disk|cloud)\.[^\s"')]+/g, '[адрес скрыт]')
    .replace(/\b[0-9a-f]{32,}\b/g, '[ключ скрыт]');
}

// ---- the "Своя нода" wizard (the core's --node-wizard) ----

/** How to reach the VDS. Passwords and the key live only in memory. */
export interface SshTarget {
  host: string;
  port: number;
  user: string;
  password: string;
  privateKey: string;
  passphrase: string;
  /** The trusted SHA256 fingerprint, "" for a server seen the first time. */
  hostKey: string;
}

/** What node-install.sh found on the server. */
export interface ServerProbe {
  arch?: string;
  os?: string;
  systemd?: boolean;
  /** root, nopasswd, password or none. */
  sudo?: string;
  core?: string;
  /** The server's core updater (openflux-node-update.timer) is on. */
  autoupdate?: boolean;
  channels?: string[];
}

/** What installing a channel will change, for the confirmation step. */
export interface NodePlan {
  channel?: string;
  port: number;
  arch?: string;
  core?: string;
  actions?: string[];
  untouched?: string[];
}

/** What the server kept after an install besides the channel. */
export interface NodeInstalled {
  /** The command that removes the node on the server ("" when the core cannot leave one). */
  uninstall: string;
  /** Why the uninstall command could not be left there; the channel runs anyway. */
  uninstallError: string;
}

/** A new channel's name on the server and its encryption key. */
export interface NewChannel {
  id: string;
  key: string;
}

/** One of a channel's carriers besides direct, as the core's provision.ChannelTransport. */
export interface NodeTransport {
  type: TransportType;
  /** The document link, or cups.online's packed room list. */
  url: string;
}

/** A server the wizard installed on before, to fill the form again. */
export interface KnownServer {
  host: string;
  port: number;
  user: string;
}

/** A failed wizard call, with what the core said about it. */
export interface WizardFailure {
  error: string;
  /** With `trust`: a new server's fingerprint to confirm; with `mismatch`: a changed one. */
  hostKey?: string;
  trust?: boolean;
  mismatch?: boolean;
  /** sudo did not take the password. */
  sudo?: boolean;
  /** Yandex wanted a person to pass a check. */
  captcha?: boolean;
}

/** A wizard call's answer across the window bridge: Electron keeps only an error's message. */
export type WizardResult<T> = {ok: true; value: T} | ({ok: false} & WizardFailure);

const YANDEX_DOC = /^https:\/\/(docs|disk)\.yandex\.[a-z]{2,3}\/edit\/d\/[A-Za-z0-9_-]{16,200}$/;
const MAILRU_DOC = /^https:\/\/cloud\.mail\.ru\/public\/[A-Za-z0-9_-]{2,64}\/[A-Za-z0-9_-]{2,128}$/;

/** A Yandex document link without query or fragment; null when it is not one. */
export function cleanYandexDocument(url: string): string | null {
  const clean = url.trim().replace(/[?#].*$/, '');
  return YANDEX_DOC.test(clean) ? clean : null;
}

/** A Mail.ru public document link without query, fragment or trailing slash; null when it is not one. */
export function cleanMailruDocument(url: string): string | null {
  const clean = url.trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
  return MAILRU_DOC.test(clean) ? clean : null;
}

/** How the wizard names a channel's carriers, primary first: "Volga, Mail.ru и Direct". */
export function describeCarriers(types: TransportType[]): string {
  const names = [...types, 'direct' as const].map(t => TRANSPORTS[t].shortLabel);
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`;
}

/** The key a server's fingerprint is kept under in the settings. */
export const hostKeyId = (host: string, port: number) => `${host.trim().toLowerCase()}:${port}`;

/** `server` first, then the others without it, at most five. */
export function rememberServer(known: KnownServer[], server: KnownServer): KnownServer[] {
  const same = (k: KnownServer) => k.host.toLowerCase() === server.host.toLowerCase() && k.port === server.port;
  return [server, ...known.filter(k => !same(k))].slice(0, 5);
}

// ---- subscriptions: several profiles behind one URL ----

/** A list of profile links at a URL, which an update turns into the profiles it lists. */
export interface Subscription extends SubscriptionInfo {
  id: string;
  url: string;
  /** When the list was last read, 0 never. */
  updatedAt: number;
  /** Why the last update failed, "" when it did not. */
  error: string;
}

/** What an update did to a subscription's profiles. */
export interface SubscriptionUpdate {
  added: number;
  changed: number;
  removed: number;
  /** Links the core could not read, with why. */
  failed: string[];
}

/**
 * What the subscription's author says about it, in "key: value" lines before
 * the links: its name, a Telegram channel, a site and a message to the people
 * using it. Empty when not given.
 */
export interface SubscriptionInfo {
  name: string;
  /** https://t.me/… */
  telegram: string;
  /** https://… */
  site: string;
  message: string;
}

export const EMPTY_SUBSCRIPTION_INFO: SubscriptionInfo = {name: '', telegram: '', site: '', message: ''};

/** The keys a subscription's header reads, Russian ones too. */
const INFO_KEYS: Record<string, keyof SubscriptionInfo> = {
  name: 'name',
  title: 'name',
  название: 'name',
  telegram: 'telegram',
  tg: 'telegram',
  телеграм: 'telegram',
  телеграмм: 'telegram',
  site: 'site',
  website: 'site',
  сайт: 'site',
  message: 'message',
  сообщение: 'message',
};
const INFO_LINE = /^([\p{L}_-]+)\s*:\s*(.*)$/u;
/** The way the first subscriptions were named; still read. */
const SUB_TITLE = /^#\s*(?:taiga|openflux)\s+subscription\s*:\s*(.+)$/i;
const MAX_NAME = 80;
const MAX_MESSAGE = 600;

/** A Telegram channel's address from what an author may write: @name, t.me/name or the full link. */
export function telegramUrl(value: string): string {
  const v = value.trim();
  const handle = /^@?([A-Za-z0-9_]{4,64})$/.exec(v);
  if (handle) return `https://t.me/${handle[1]}`;
  const link = /^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([A-Za-z0-9_+/-]+)\/?$/i.exec(v);
  return link ? `https://t.me/${link[1]}` : '';
}

/** A site's address, https only; a bare domain gets the scheme. */
export function siteUrl(value: string): string {
  const v = value.trim();
  if (!v || /\s/.test(v)) return '';
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v.replace(/^http:/i, 'https:') : `https://${v}`);
    return url.protocol === 'https:' && url.hostname.includes('.') ? url.toString() : '';
  } catch {
    return '';
  }
}

/** One header value as it is kept: checked links, a short name, a message whose "\n" breaks lines. */
function infoValue(key: keyof SubscriptionInfo, value: string): string {
  switch (key) {
    case 'name':
      return value.trim().slice(0, MAX_NAME);
    case 'telegram':
      return telegramUrl(value);
    case 'site':
      return siteUrl(value);
    case 'message':
      return value.replace(/\\n/g, '\n').trim().slice(0, MAX_MESSAGE);
  }
}

/**
 * A subscription's text: "key: value" lines (name, telegram, site, message),
 * then the profile links, one a line; # starts a comment. The base64 of such a
 * text (the way V2Ray subscriptions are served) also reads.
 */
export function parseLinkList(text: string): SubscriptionInfo & {links: string[]} {
  let body = text.trim();
  if (body && !/\s/.test(body) && !isLink(body) && /^[A-Za-z0-9+/_-]+=*$/.test(body)) {
    try {
      const bytes = Uint8Array.from(atob(body.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      const decoded = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
      if (decoded.split(/\r?\n/).some(isLink)) body = decoded;
    } catch {
      // Not base64 after all: read it as it is.
    }
  }
  const info = {...EMPTY_SUBSCRIPTION_INFO};
  const links: string[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (isLink(line)) {
      if (!links.includes(line)) links.push(line);
      continue;
    }
    // The header goes before the links; the first of each key counts.
    const title = SUB_TITLE.exec(line);
    const pair = !title && !links.length ? INFO_LINE.exec(line) : null;
    const key = title ? 'name' : pair ? INFO_KEYS[pair[1].toLowerCase()] : undefined;
    if (key && !info[key]) info[key] = infoValue(key, title ? title[1] : pair![2]);
  }
  return {...info, links};
}

/** A subscription's text: its header, a note on what it holds and one link a line. */
export function formatSubscription(info: SubscriptionInfo, links: string[], now: number): string {
  const header: [string, string][] = [
    ['name', info.name.trim() || 'Taiga'],
    ['telegram', telegramUrl(info.telegram)],
    ['site', siteUrl(info.site)],
    ['message', info.message.trim().replace(/\r?\n/g, '\\n')],
  ];
  return [
    ...header.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
    `# Taiga subscription, ${new Date(now).toISOString().slice(0, 10)}: ${links.length} ${plural(links.length, 'профиль', 'профиля', 'профилей')}. Внутри ключи шифрования: передавайте только своим.`,
    ...links,
    '',
  ].join('\n');
}

/** The Russian plural form for n: профиль, профиля, профилей. */
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// ---- availability checks ----

/** ok: works; warning: works with a catch (a captcha to pass); fail: does not; skipped: not checked. */
export type CheckStatus = 'running' | 'ok' | 'warning' | 'fail' | 'skipped';

/** One carrier's quick check: can this computer reach the place where it meets the node. */
export interface CarrierCheck {
  type: TransportType;
  status: CheckStatus;
  text: string;
  /** How long the answer took. */
  ms?: number;
}

/**
 * A profile's last check. Quick: each carrier's way to the node, without
 * joining the channel. Full: a request through the node itself.
 */
export interface ProfileCheck {
  kind: 'quick' | 'full';
  status: CheckStatus;
  /** Short, for the profile list: "доступен", "капча", "420 мс". */
  summary: string;
  at: number;
  carriers: CarrierCheck[];
  /** Full: a request's round trip through the node, the exit's address and the carriers that carried it. */
  ms?: number;
  exitIp?: string;
  via?: string[];
  /** Full: why it did not get through. */
  error?: string;
}

/** The worst of several statuses, ignoring the skipped. */
export function worstStatus(list: CheckStatus[]): CheckStatus {
  const order: CheckStatus[] = ['running', 'fail', 'warning', 'ok'];
  return order.find(s => list.includes(s)) ?? 'skipped';
}
