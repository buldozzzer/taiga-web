import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import dns from 'node:dns/promises';
import {type LogLevel, type NewChannel, type NodeInstalled, type NodePlan, type NodeTransport, type ServerProbe, type SshTarget, type WizardResult, fromCoreLink} from '../../shared/model.js';

type Fields = Record<string, unknown>;

interface Pending {
  id: number;
  resolve(reply: Fields): void;
  reject(error: Error): void;
}

/**
 * The "Своя нода" wizard's server side through the core's --node-wizard:
 * one helper process for the wizard's lifetime, JSON lines on stdin/stdout,
 * one call at a time. The helper holds the SSH connection between calls.
 * Secrets go only through the pipe, never on the command line or into the log.
 */
export class NodeWizardService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private pending: Pending | null = null;
  private nextId = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private core: () => string | null,
    private log: (level: LogLevel, text: string) => void,
  ) {}

  connect(t: SshTarget): Promise<WizardResult<ServerProbe>> {
    return this.call('connect', `${t.host}:${t.port} (${t.user})`, {
      host: t.host,
      port: t.port,
      user: t.user,
      password: t.password,
      privateKey: t.privateKey,
      passphrase: t.passphrase,
      hostKey: t.hostKey,
    }, r => (r.probe ?? {}) as ServerProbe);
  }

  newChannel(): Promise<WizardResult<NewChannel>> {
    return this.call('newChannel', '', {}, r => ({id: String(r.channel ?? ''), key: String(r.key ?? '')}));
  }

  plan(channel: string, transports: NodeTransport[], autoUpdate: boolean): Promise<WizardResult<NodePlan>> {
    return this.call('plan', `channel=${channel} ${names(transports)} autoUpdate=${autoUpdate}`, {
      channel,
      channelPort: 0,
      transports,
      autoUpdate,
    }, r => r.plan as NodePlan);
  }

  apply(channel: NewChannel, transports: NodeTransport[], port: number, autoUpdate: boolean, sudoPassword: string): Promise<WizardResult<NodeInstalled>> {
    return this.call('apply', `channel=${channel.id} ${names(transports)} port=${port} autoUpdate=${autoUpdate}`, {
      channel: channel.id,
      key: channel.key,
      transports,
      channelPort: port,
      autoUpdate,
      sudoPassword,
    }, r => {
      // A core without the uninstaller says neither (a custom core, older than Taiga's patch).
      const installed = {uninstall: String(r.uninstall ?? ''), uninstallError: String(r.uninstallError ?? '')};
      if (installed.uninstallError) this.log('warning', `мастер: ${installed.uninstallError}`);
      return installed;
    });
  }

  remove(channel: string, sudoPassword: string): Promise<WizardResult<null>> {
    return this.call('remove', `channel=${channel}`, {channel, sudoPassword}, () => null);
  }

  checkDocument(documentUrl: string): Promise<WizardResult<null>> {
    return this.call('checkDocument', '', {documentUrl}, () => null);
  }

  createRooms(): Promise<WizardResult<string>> {
    return this.call('createRooms', '', {}, r => String(r.rooms ?? ''));
  }

  shareLink(name: string, key: string, host: string, port: number, transports: NodeTransport[]): Promise<WizardResult<string>> {
    return this.call('shareLink', `${host}:${port} ${names(transports)}`, {name, key, host, channelPort: port, transports}, r =>
      fromCoreLink(String(r.link ?? '')),
    );
  }

  async resolve(host: string): Promise<string[]> {
    try {
      const found = (await dns.lookup(host, {all: true})).map(a => a.address);
      this.log('debug', `мастер: resolve ${host} -> ${found.join(', ')}`);
      return found;
    } catch (e) {
      this.log('warning', `мастер: resolve ${host} не удался: ${(e as Error).message}`);
      return [];
    }
  }

  /** Ends the helper: closing its stdin closes SSH and removes the installer it downloaded. */
  close() {
    const child = this.child;
    this.child = null;
    if (!child) return;
    this.log('info', 'мастер: закрываю ядро');
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 5000);
    child.once('exit', () => clearTimeout(timer));
  }

  /** Runs calls one after another: the helper answers in order. */
  private call<T>(method: string, summary: string, params: Fields, pick: (reply: Fields) => T): Promise<WizardResult<T>> {
    const run = async (): Promise<WizardResult<T>> => {
      const label = summary ? `${method} ${summary}` : method;
      this.log('debug', `мастер: → ${label}`);
      let reply: Fields;
      try {
        reply = await this.send(method, params);
      } catch (e) {
        this.log('error', `мастер: ← ${label} ${(e as Error).message}`);
        return {ok: false, error: (e as Error).message};
      }
      if (reply.ok !== true) {
        const error = typeof reply.error === 'string' && reply.error ? reply.error : 'Ошибка мастера';
        this.log('error', `мастер: ← ${label} ошибка: ${error}`);
        return {
          ok: false,
          error,
          hostKey: typeof reply.hostKey === 'string' && reply.hostKey ? reply.hostKey : undefined,
          trust: reply.trust === true,
          mismatch: reply.mismatch === true,
          sudo: reply.sudo === true,
          captcha: reply.captcha === true,
        };
      }
      this.log('debug', `мастер: ← ${label} ok`);
      return {ok: true, value: pick(reply)};
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  private send(method: string, params: Fields): Promise<Fields> {
    const child = this.child ?? this.start();
    const id = ++this.nextId;
    return new Promise<Fields>((resolve, reject) => {
      this.pending = {id, resolve, reject};
      child.stdin.write(`${JSON.stringify({id, method, params})}\n`, e => e && this.failPending());
    });
  }

  /** The helper ended or its pipe broke: the waiting call gets no answer. */
  private failPending() {
    const pending = this.pending;
    this.pending = null;
    pending?.reject(new Error('Ядро не ответило мастеру'));
  }

  private start(): ChildProcessWithoutNullStreams {
    const core = this.core();
    if (!core) throw new Error('Не найдено ядро: укажите его в настройках');
    this.log('info', `мастер: запускаю ${core} --node-wizard`);
    const child = spawn(core, ['--node-wizard'], {windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
    this.child = child;
    this.buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      let newline;
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (line) this.onLine(line);
      }
    });
    // The helper's stderr is the core's own log: secrets never reach it, but it is noisy.
    child.stderr.resume();
    child.on('exit', () => {
      if (this.child !== child) return;
      this.child = null;
      this.failPending();
    });
    child.on('error', e => {
      this.log('error', `мастер: ${e.message}`);
      if (this.child === child) {
        this.child = null;
        this.failPending();
      }
    });
    return child;
  }

  private onLine(line: string) {
    let reply: Fields;
    try {
      reply = JSON.parse(line);
    } catch {
      return;
    }
    // Lines for other calls (progress of a streamed call) are not ours to answer.
    const pending = this.pending;
    if (!pending || reply.id !== pending.id) return;
    this.pending = null;
    pending.resolve(reply);
  }
}

/** For the log: the carriers' types only; links and rooms stay out. */
const names = (transports: NodeTransport[]) => `transports=${transports.map(t => t.type).join(',') || 'direct'}`;
