import {type AppSettings, type Profile, TRANSPORTS, carriers, profileProblems, sessionSpecs} from '../../shared/model.js';

/** Paths the core gets for one run. */
export interface CorePaths {
  keyFile: string | null;
  confFile: string;
  cookieStore: string;
  ipcSocket: string | null;
}

/** How to start the core for a profile: the .conf body (Session) and flags. */
export interface CoreLaunch {
  args: string[];
  conf: string | null;
  socksAddress: string | null;
  httpProxyAddress: string | null;
  /** The core's IPC status says whether it reaches the exit (Sessions); otherwise its log does. */
  usesIpc: boolean;
}

const LOOPBACK = '127.0.0.1';

/**
 * Turns a profile and the settings into the core's command line. Sessions go
 * through a --config file (the only way to name several transports of one
 * type); classic profiles use the single-transport flags.
 */
export function buildLaunch(profile: Profile, settings: AppSettings, paths: CorePaths): CoreLaunch {
  const problems = profileProblems(profile);
  if (problems.length) throw new Error(problems[0]);
  const exit = settings.mode === 'exit';
  const socks = `${LOOPBACK}:${settings.socksPort}`;
  const http = `${LOOPBACK}:${settings.socksPort + 1}`;
  if (profile.stream) {
    if (exit) throw new Error('Режим без сервера работает только как клиент: выхода в нём нет, сервер заменяет PHP-хостинг');
    return stream(profile, settings, paths, socks, http);
  }
  return profile.session
    ? session(profile, settings, paths, exit, socks, http)
    : classic(profile, settings, paths, exit, socks, http);
}

function session(p: Profile, s: AppSettings, paths: CorePaths, exit: boolean, socks: string, http: string): CoreLaunch {
  if (!paths.keyFile) throw new Error('Для режима Session нужен ключ');
  const lines: string[] = [`# Taiga: ${p.name.replace(/[\r\n]/g, ' ')}`, '[Interface]'];
  if (exit) lines.push('Role = exit', 'Mode = l4');
  else if (s.fullTunnel) lines.push('Role = client', 'Inbound = tun');
  else lines.push('Role = client', 'Inbound = socks5', `Socks5 = ${socks}`);
  lines.push(`EncryptionKeyFile = ${confValue(paths.keyFile)}`);
  lines.push(`CookieStore = ${confValue(paths.cookieStore)}`);
  for (const spec of sessionSpecs(p).filter(x => !(exit && x.type === 'direct'))) {
    lines.push('', `[Transport ${spec.name}]`, `Type = ${spec.type}`, `Priority = ${spec.priority}`);
    switch (TRANSPORTS[spec.type].kind) {
      case 'documentUrl':
        lines.push(`URL = ${confValue(spec.value)}`);
        break;
      case 'address':
        lines.push(`Dial = ${confValue(spec.value)}`);
        break;
      case 'token':
        lines.push(`Token = ${confValue(spec.value)}`, `UID = ${confValue(spec.uid)}`);
        break;
    }
  }
  // The exit listens for direct only when the profile has it.
  const direct = carriers(p).find(c => c.type === 'direct');
  if (exit && direct) {
    lines.push('', '[Transport direct]', 'Type = direct', `Priority = ${direct.priority}`, `Listen = 0.0.0.0:${s.exitDirectPort}`);
  }
  const args = ['--config', paths.confFile];
  // An imported context goes on the command line (.conf values end at '#').
  if (p.context.trim()) args.push(`--session-context=${p.context.trim()}`);
  if (paths.ipcSocket) args.push(`--ipc-socket=${paths.ipcSocket}`);
  if (exit) {
    args.push('--share');
    if (s.exitShareHost.trim()) args.push(`--share-host=${s.exitShareHost.trim()}`);
  } else if (!s.fullTunnel) {
    args.push(`--http-proxy=${http}`);
  }
  if (s.debugLevel > 0) args.push(`--debug=${s.debugLevel}`);
  const proxies = !exit && !s.fullTunnel;
  return {
    args,
    conf: lines.join('\n') + '\n',
    socksAddress: proxies ? socks : null,
    httpProxyAddress: proxies ? http : null,
    usesIpc: paths.ipcSocket != null,
  };
}

/** The mode without a server: the core's --mode=stream, as proxies or through TUN. */
function stream(p: Profile, s: AppSettings, paths: CorePaths, socks: string, http: string): CoreLaunch {
  const args = ['--role=client', '--mode=stream'];
  if (s.fullTunnel) args.push('--inbound=tun');
  else args.push('--inbound=socks5', `--socks5=${socks}`, `--http-proxy=${http}`);
  args.push(`--transport=${p.transport}`, `--url=${p.value.trim()}`);
  if (paths.ipcSocket && !s.fullTunnel) args.push(`--ipc-socket=${paths.ipcSocket}`);
  if (s.debugLevel > 0) args.push(`--debug=${s.debugLevel}`);
  return s.fullTunnel
    ? {args, conf: null, socksAddress: null, httpProxyAddress: null, usesIpc: false}
    : {args, conf: null, socksAddress: socks, httpProxyAddress: http, usesIpc: false};
}

function classic(p: Profile, s: AppSettings, paths: CorePaths, exit: boolean, socks: string, http: string): CoreLaunch {
  const args: string[] = [];
  if (exit) args.push('--role=exit', '--mode=l4');
  else if (s.fullTunnel) args.push('--role=client', '--inbound=tun');
  else args.push('--role=client', '--inbound=socks5', `--socks5=${socks}`, `--http-proxy=${http}`);
  args.push(`--transport=${p.transport}`, `--codec=${p.codec}`);
  if (p.transport === 'oneme') args.push(`--maxToken=${p.value.trim()}`, `--maxUid=${p.uid.trim()}`);
  else args.push(`--url=${p.value.trim()}`);
  if (paths.keyFile) args.push(`--encryption-key-file=${paths.keyFile}`);
  args.push(`--cookie-store=${paths.cookieStore}`);
  // Traffic totals for the speed chart; the state still comes from the log.
  if (paths.ipcSocket) args.push(`--ipc-socket=${paths.ipcSocket}`);
  if (exit) {
    args.push('--share');
    if (s.exitShareHost.trim()) args.push(`--share-host=${s.exitShareHost.trim()}`);
  }
  if (s.debugLevel > 0) args.push(`--debug=${s.debugLevel}`);
  return exit || s.fullTunnel
    ? {args, conf: null, socksAddress: null, httpProxyAddress: null, usesIpc: false}
    : {args, conf: null, socksAddress: socks, httpProxyAddress: http, usesIpc: false};
}

/** .conf values end at '#' or ';' (comments); refuse ones that would be cut. */
function confValue(value: string): string {
  if (/[#;\r\n]/.test(value)) {
    throw new Error(`Значение «${value.slice(0, 40)}» нельзя передать ядру: в нём есть # или ;`);
  }
  return value;
}
