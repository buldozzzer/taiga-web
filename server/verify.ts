import {spawn} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {ProxyAgent, fetch as proxyFetch} from 'undici';
import {type Profile, DEFAULT_SETTINGS} from '../shared/model.js';
import type {NodeCheck} from '../shared/panel.js';
import {buildLaunch} from './core/config.js';
import {connectIpc, type IpcConnection} from './core/ipc.js';
import {corePath} from './core.js';
import {env, runtimeDir} from './env.js';

const TIMEOUT_MS = 90_000;
const REQUEST_TIMEOUT_MS = 15_000;
const IP_URL = 'https://api.ipify.org';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Two free ports in a row: SOCKS and the HTTP proxy after it. */
async function freePortPair(): Promise<number> {
  const listen = (port: number) =>
    new Promise<number | null>(resolve => {
      const server = net.createServer();
      server.once('error', () => resolve(null));
      server.listen(port, '127.0.0.1', () => {
        const got = (server.address() as net.AddressInfo).port;
        server.close(() => resolve(got));
      });
    });
  for (let i = 0; i < 20; i++) {
    const port = await listen(0);
    if (port && port < 65535 && (await listen(port + 1))) return port;
  }
  throw new Error('Не нашлось свободного порта для проверки');
}

/** What the core's log says went wrong, in words (the client's friendlyProblem). */
function problemIn(line: string): string | null {
  const lower = line.toLowerCase();
  if (lower.includes('address already in use')) return 'Порт проверки уже занят';
  if (lower.includes('read encryption key file')) return 'Ядро не смогло прочитать ключ шифрования';
  if (lower.includes('--config:')) return `Ядро не приняло конфигурацию: ${line.split('--config:')[1].trim()}`;
  if (lower.includes('failed to start transport')) return `Транспорт не запустился: ${line.split('transport:').pop()!.trim().slice(0, 160)}`;
  if (lower.includes('encryption key differs')) return 'Ключ шифрования не совпадает с ключом ноды';
  if (lower.includes('nothing arrived from the exit')) return 'От ноды ничего не приходит: она выключена, слушает другой документ или другой транспорт';
  if (lower.includes('no carrier is connected on this side')) return 'Ни один транспорт не подключился: документ недоступен, нужна капча или нет сети';
  if (lower.includes('fatal')) return line.split(': ').slice(1).join(': ').slice(0, 200) || line.slice(0, 200);
  return null;
}

let running = false;

/**
 * Runs the core as a client for the profile on spare loopback ports and asks
 * through it where the traffic leaves. One check at a time: each one joins the
 * channel as another client.
 */
export async function checkThroughNode(profile: Profile, onProgress: (text: string) => void = () => {}): Promise<NodeCheck> {
  if (running) throw new Error('Уже идёт проверка через ноду, дождитесь её');
  running = true;
  try {
    return await run(profile, onProgress);
  } catch (e) {
    return {at: Date.now(), ok: false, exitIp: '', ms: 0, via: [], error: (e as Error).message};
  } finally {
    running = false;
  }
}

async function run(profile: Profile, onProgress: (text: string) => void): Promise<NodeCheck> {
  const core = corePath();
  if (!core) throw new Error(`Не найдено ядро: ${env.core}`);
  const port = await freePortPair();
  const settings = {...DEFAULT_SETTINGS, mode: 'client' as const, systemProxy: false, fullTunnel: false, socksPort: port};
  const dir = fs.mkdtempSync(path.join(runtimeDir, 'check-'));
  let keyFile: string | null = null;
  if (profile.secret) {
    keyFile = path.join(dir, 'key');
    fs.writeFileSync(keyFile, profile.secret, {mode: 0o600});
  }
  const confFile = path.join(dir, 'core.conf');
  const ipcSocket = path.join(dir, 'core.sock');
  // Cookies Yandex let through once stay with the node for the next check.
  const cookieStore = path.join(env.dataDir, 'cookies', `${profile.id.slice(0, 8)}.json`);
  fs.mkdirSync(path.dirname(cookieStore), {recursive: true, mode: 0o700});

  const launch = buildLaunch(profile, settings, {keyFile, confFile, cookieStore, ipcSocket});
  if (launch.conf) fs.writeFileSync(confFile, launch.conf, {mode: 0o600});
  const child = spawn(core, launch.args, {cwd: dir, stdio: ['ignore', 'pipe', 'pipe']});

  const state = {exited: false, banner: false, connected: false, captcha: '', via: [] as string[], problem: '', diagnosed: false};
  child.once('exit', () => (state.exited = true));
  child.once('error', e => {
    state.exited = true;
    state.problem = `Не удалось запустить ядро: ${e.message}`;
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (!line.trim()) continue;
        if (line.includes('Running as CLIENT')) state.banner = true;
        const problem = problemIn(line);
        if (problem) state.problem = problem;
        if (line.includes('handshake not complete') && problem) state.diagnosed = true;
      }
    });
  }
  let ipc: IpcConnection | null = null;
  if (launch.usesIpc) {
    ipc = connectIpc(ipcSocket, 15_000, null, {
      onOpen: () => {},
      onClose: () => {},
      onMessage: m => {
        if (m.type === 'cookies') state.captcha = m.request.reason || new URL(m.request.url).host;
        else {
          state.connected = !!m.status.connected;
          state.via = m.status.active_all ?? (m.status.active ? [m.status.active] : []);
        }
      },
    });
  }

  const agent = new ProxyAgent(`http://${launch.httpProxyAddress}`);
  const request = async () => {
    const started = performance.now();
    const r = await proxyFetch(IP_URL, {dispatcher: agent, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
    const ip = (await r.text()).trim();
    if (!r.ok || !/^[0-9a-fA-F:.]{3,45}$/.test(ip)) throw new Error(`${new URL(IP_URL).host} ответил ${r.status}`);
    return {ip, ms: Math.round(performance.now() - started)};
  };

  const deadline = Date.now() + TIMEOUT_MS;
  try {
    onProgress('Поднимаю ядро и жду ответа ноды…');
    let lastError = '';
    while (Date.now() < deadline) {
      if (state.captcha) {
        throw new Error(`Яндекс просит у сервера панели пройти проверку (${state.captcha}): проверьте ноду в клиенте Taiga, там капча проходится в окне браузера`);
      }
      if (state.exited) throw new Error(state.problem || 'Ядро завершилось, не дойдя до ноды');
      if (state.diagnosed) throw new Error(state.problem);
      const ready = launch.usesIpc ? state.connected : state.banner;
      if (ready) {
        onProgress(lastError ? 'Канал поднялся, пробую запрос ещё раз…' : 'Канал поднялся, отправляю запрос через ноду…');
        try {
          const first = await request();
          // The second request rides the connection the first opened: the node's round trip.
          const second = await request().catch(() => first);
          return {at: Date.now(), ok: true, exitIp: second.ip, ms: second.ms, via: state.via, error: ''};
        } catch (e) {
          lastError = (e as Error).message;
        }
      }
      await sleep(500);
    }
    throw new Error(
      state.problem ||
        (launch.usesIpc && !state.connected
          ? 'Нода не ответила за 90 с: она выключена или канал занят другим клиентом'
          : `Запросы через ноду не прошли за 90 с${lastError ? `: ${lastError}` : ''}`),
    );
  } finally {
    ipc?.close();
    child.kill();
    await agent.close().catch(() => {});
    fs.rmSync(dir, {recursive: true, force: true});
  }
}
