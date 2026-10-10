import {
  type NewChannel,
  type NodePlan,
  type NodeTransport,
  type Profile,
  type ServerProbe,
  type SshTarget,
  type WizardFailure,
  type WizardResult,
  cleanMailruDocument,
  cleanYandexDocument,
  fromShare,
  hostKeyId,
  rememberServer,
} from '../../shared/model.js';
import type {NodeCheck, NodeRecord, WizardStep, WizardView} from '../../shared/panel.js';
import {corePath, readLink} from '../core.js';
import {db, documentTakenError, newId, settings} from '../db.js';
import {log} from '../log.js';
import {readSshKey} from '../sshkey.js';
import {checkThroughNode} from '../verify.js';
import {NodeWizardService} from './service.js';

/** The saved key as the wizard offers it: "ed25519 SHA256:…", "" without one. */
function savedKeyLabel(): string {
  const {sshPrivateKey, sshPassphrase} = settings();
  if (!sshPrivateKey) return '';
  try {
    const k = readSshKey(sshPrivateKey, sshPassphrase);
    return `${k.type} ${k.fingerprint}`.trim();
  } catch {
    return 'ключ из настроек';
  }
}

/** A failed call, with the core's flags (a host key to trust, a wrong sudo password, a Yandex check). */
class WizardError extends Error {
  constructor(readonly failure: WizardFailure) {
    super(failure.error);
  }
}

async function unwrap<T>(call: Promise<WizardResult<T>>): Promise<T> {
  const r = await call;
  if (!r.ok) throw new WizardError(r);
  return r.value;
}

/** A connection quiet for longer is opened again before the next call. */
const SSH_IDLE_MS = 60_000;

export interface ServerForm {
  host: string;
  port: string;
  user: string;
  useKey: boolean;
  /** Log in with the key saved in the panel's settings: it never comes from the page. */
  useSavedKey?: boolean;
  password: string;
  privateKey: string;
  passphrase: string;
}

export interface CarriersForm {
  name: string;
  useVolga: boolean;
  useMailru: boolean;
  useCups: boolean;
  documentUrl: string;
  docId: string;
  mailruInput: string;
}

/**
 * "Своя нода" on the panel's server, as the client's NodeWizardModel: SSH to
 * the VDS; the channel's carriers; what will change there; install; a real
 * request through the new node from the panel's own core. The page only
 * shows `view()` and sends actions; passwords and the key stay here, in
 * memory, for the length of the wizard.
 */
export class WizardSession {
  private service = new NodeWizardService(corePath, (level, text) => log(level, text));
  private step: WizardStep = 'server';
  private busy: string | null = null;
  private error: string | null = null;
  private notice: string | null = null;

  private host = '';
  private port = '22';
  private user = 'root';
  private hostKeyPrompt: {fingerprint: string; mismatch: boolean} | null = null;
  private pendingForm: ServerForm | null = null;
  private probe: ServerProbe | null = null;
  private target: SshTarget | null = null;
  private lastServerReply = 0;
  private usedKey = false;
  private sshPassword = '';

  private channel: NewChannel | null = null;
  private carriers: CarriersForm = {name: '', useVolga: true, useMailru: false, useCups: false, documentUrl: '', docId: '', mailruInput: ''};
  private documentWarning = '';
  private checkedDocument = '';
  private cupsRooms = '';

  private plan: NodePlan | null = null;
  private sudoPassword = '';
  private autoUpdate = true;
  private transports: NodeTransport[] = [];

  private installed = false;
  private uninstallCommand = '';
  private uninstallError = '';
  private shareLink = '';
  private profile: Profile | null = null;
  private check: NodeCheck | null = null;
  private verifyFailed: string | null = null;
  private savedNodeId = '';
  private closed = false;

  view(): WizardView {
    return {
      active: !this.closed,
      step: this.step,
      busy: this.busy,
      error: this.error,
      notice: this.notice,
      host: this.host,
      port: this.port,
      user: this.user,
      hostKeyPrompt: this.hostKeyPrompt,
      probe: this.probe,
      channel: this.channel?.id ?? '',
      ...this.carriers,
      documentWarning: this.documentWarning,
      plan: this.plan,
      needsSudoPassword: this.probe?.sudo === 'password',
      autoUpdate: this.autoUpdate,
      transports: this.transports.map(t => t.type),
      installed: this.installed,
      uninstallCommand: this.uninstallCommand,
      uninstallError: this.uninstallError,
      verifiedIp: this.check?.ok ? this.check.exitIp : '',
      verifyMs: this.check?.ms ?? 0,
      verifyVia: this.check?.via ?? [],
      verifyFailed: this.verifyFailed,
      savedNodeId: this.savedNodeId,
      knownServers: db.get().knownServers,
      savedKey: savedKeyLabel(),
      savedKeyUser: settings().sshUser,
    };
  }

  private get profileName(): string {
    return this.carriers.name.trim() || `Нода ${this.host}`;
  }

  // ---- step 1: server ----

  connect(sent: ServerForm, trusted?: string) {
    const s = settings();
    const form: ServerForm = sent.useKey && sent.useSavedKey ? {...sent, privateKey: s.sshPrivateKey, passphrase: s.sshPassphrase} : sent;
    const host = form.host.trim();
    const user = form.user.trim();
    const port = Number(form.port.trim());
    this.host = host;
    this.port = form.port.trim();
    this.user = user;
    if (!host || !user || !Number.isInteger(port) || port < 1 || port > 65535) return this.fail('Укажите адрес, порт и логин');
    if (form.useKey && !form.privateKey.trim()) return this.fail(sent.useSavedKey ? 'Сохранённого ключа больше нет: вставьте ключ' : 'Вставьте приватный ключ');
    if (!form.useKey && !form.password) return this.fail('Введите пароль');
    const target: SshTarget = {
      host,
      port,
      user,
      password: form.useKey ? '' : form.password,
      privateKey: form.useKey ? form.privateKey.trim() : '',
      passphrase: form.useKey ? form.passphrase : '',
      hostKey: trusted ?? db.get().knownHostKeys[hostKeyId(host, port)] ?? '',
    };
    this.run(
      'Подключаюсь к серверу и проверяю его…',
      async () => {
        const probe = await unwrap(this.service.connect(target));
        this.target = target;
        this.usedKey = form.useKey;
        this.sshPassword = form.useKey ? '' : form.password;
        this.lastServerReply = Date.now();
        db.update(d => (d.knownServers = rememberServer(d.knownServers, {host, port, user})));
        const channel = this.channel ?? (await unwrap(this.service.newChannel()));
        if (!this.carriers.name.trim()) this.carriers.name = `Нода ${host}`;
        Object.assign(this, {probe, channel, step: 'transports'});
      },
      f => {
        if (f.hostKey && (f.trust || f.mismatch)) {
          this.hostKeyPrompt = {fingerprint: f.hostKey, mismatch: !!f.mismatch};
          this.pendingForm = sent;
          return true;
        }
        return false;
      },
    );
  }

  trustHostKey() {
    const prompt = this.hostKeyPrompt;
    const form = this.pendingForm;
    if (!prompt || !form) return;
    this.hostKeyPrompt = null;
    this.pendingForm = null;
    const port = Number(this.port);
    db.update(d => (d.knownHostKeys[hostKeyId(this.host, port)] = prompt.fingerprint));
    this.connect(form, prompt.fingerprint);
  }

  rejectHostKey() {
    this.hostKeyPrompt = null;
    this.pendingForm = null;
  }

  // ---- step 2: carriers ----

  /** Goes on to the plan: checks a new Yandex link first, as the node will see it. */
  next(form: CarriersForm) {
    this.carriers = {...form};
    this.run('Готовлю транспорты канала…', async () => {
      const chosen: NodeTransport[] = [];
      if (form.useVolga) {
        const clean = cleanYandexDocument(form.documentUrl);
        if (!clean) throw new WizardError({error: 'Нужна ссылка вида https://docs.yandex.ru/edit/d/…: создайте документ или вставьте свой'});
        this.carriers.documentUrl = clean;
        const taken = documentTakenError(clean);
        if (taken) throw new WizardError({error: taken});
        if (clean !== this.checkedDocument) await this.checkDocument(clean);
        chosen.push({type: 'vyandex', url: clean});
      }
      if (form.useMailru) {
        const link = cleanMailruDocument(form.mailruInput);
        if (!link) throw new WizardError({error: 'Нужна публичная ссылка Mail.ru вида https://cloud.mail.ru/public/…/…'});
        this.carriers.mailruInput = link;
        chosen.push({type: 'mailru', url: link});
      }
      if (form.useCups) {
        if (!this.cupsRooms) {
          this.busy = 'Создаю комнаты cups.online…';
          this.cupsRooms = await unwrap(this.service.createRooms());
        }
        chosen.push({type: 'cupsonline', url: this.cupsRooms});
      }
      this.transports = chosen;
      await this.askPlan();
      if (this.probe?.sudo === 'password' && !this.sudoPassword && !this.usedKey) this.sudoPassword = this.sshPassword;
      this.step = 'plan';
    });
  }

  private async checkDocument(url: string) {
    this.busy = 'Проверяю документ так, как его увидит нода…';
    let warning = '';
    try {
      await unwrap(this.service.checkDocument(url));
    } catch (e) {
      // Yandex challenges the panel's address; the node checks from its own.
      if (!(e instanceof WizardError && e.failure.captcha)) throw e;
      warning = 'Яндекс попросил проверку у сервера панели, поэтому документ проверит сама нода при запуске.';
    }
    this.documentWarning = warning;
    this.checkedDocument = url;
  }

  private async askPlan() {
    this.busy = 'Спрашиваю сервер, что изменится…';
    this.plan = await this.onServer(true, () => unwrap(this.service.plan(this.channel!.id, this.transports, this.autoUpdate)));
  }

  setAutoUpdate(on: boolean) {
    if (this.busy || on === this.autoUpdate) return;
    this.autoUpdate = on;
    this.run('Спрашиваю сервер, что изменится…', () => this.askPlan());
  }

  back() {
    if (this.busy) return;
    const previous: Partial<Record<WizardStep, WizardStep>> = {transports: 'server', plan: 'transports'};
    this.error = null;
    this.step = previous[this.step] ?? this.step;
  }

  // ---- step 3: install ----

  install(sudoPassword: string) {
    const {channel, plan} = this;
    if (!channel || !plan) return;
    if (sudoPassword) this.sudoPassword = sudoPassword;
    if (this.probe?.sudo === 'password' && !this.sudoPassword) return this.fail('Введите пароль sudo');
    // Another node may have taken the document since the carriers step.
    const volga = this.transports.find(t => t.type === 'vyandex');
    const taken = volga && !this.installed ? documentTakenError(volga.url) : '';
    if (taken) return this.fail(taken);
    this.run(
      'Устанавливаю ноду: скачиваю ядро, пишу конфигурацию, запускаю…',
      async () => {
        const kept = await this.onServer(false, () =>
          unwrap(this.service.apply(channel, this.transports, plan.port, this.autoUpdate, this.sudoPassword)),
        );
        Object.assign(this, {installed: true, uninstallCommand: kept.uninstall, uninstallError: kept.uninstallError});
        const link = await unwrap(this.service.shareLink(this.profileName, channel.key, this.host, plan.port, this.transports));
        const profile = fromShare(await readLink(link), newId(), Date.now(), 'node');
        this.shareLink = link;
        this.profile = {...profile, name: this.profileName};
        await this.verifyNow();
      },
      f => {
        if (f.sudo) {
          this.error = 'sudo не принял пароль';
          return true;
        }
        return false;
      },
    );
  }

  // ---- step 4: verification ----

  verify() {
    if (this.profile) this.run('Подключаюсь к новой ноде…', () => this.verifyNow());
  }

  /** The panel's core goes through the new node: the request must leave from the server's address. */
  private async verifyNow() {
    this.step = 'verify';
    this.verifyFailed = null;
    this.check = null;
    const expected = await this.service.resolve(this.host);
    const check = await checkThroughNode(this.profile!, text => (this.busy = text));
    if (check.ok && expected.length && !expected.includes(check.exitIp)) {
      check.ok = false;
      check.error = `Запрос вышел с адреса ${check.exitIp}, а не с адреса сервера (${expected.join(', ')})`;
    }
    this.check = check;
    if (check.ok) this.step = 'done';
    else this.verifyFailed = check.error || 'Проверка не прошла';
  }

  skipVerification() {
    this.verifyFailed = null;
    this.step = 'done';
  }

  removeChannel(sudoPassword: string) {
    const channel = this.channel;
    if (!channel) return;
    if (sudoPassword) this.sudoPassword = sudoPassword;
    this.run(
      'Удаляю канал с сервера…',
      async () => {
        await this.onServer(false, () => unwrap(this.service.remove(channel.id, this.sudoPassword)));
        this.installed = false;
        this.notice = `Канал ${channel.id} удалён с сервера`;
      },
      f => {
        if (f.sudo) {
          this.error = 'sudo не принял пароль';
          return true;
        }
        return false;
      },
    );
  }

  // ---- done ----

  /** Keeps the node in the panel: it can then go into subscriptions. */
  save(): string {
    if (this.savedNodeId) return this.savedNodeId;
    if (!this.profile || !this.plan || !this.channel) throw new Error('Нода ещё не установлена');
    const node: NodeRecord = {
      id: newId(),
      name: this.profileName,
      host: this.host,
      port: this.plan.port,
      channel: this.channel.id,
      transports: this.transports,
      link: this.shareLink,
      source: 'wizard',
      uninstall: this.uninstallCommand,
      createdAt: Date.now(),
      check: this.check,
    };
    db.update(d => d.nodes.push(node));
    log('success', `Нода «${node.name}» сохранена`);
    this.savedNodeId = node.id;
    return node.id;
  }

  get unsaved(): boolean {
    return this.installed && !this.savedNodeId;
  }

  /** Ends SSH and forgets the secrets. */
  close() {
    this.closed = true;
    this.service.close();
    this.target = null;
    this.pendingForm = null;
    this.sshPassword = '';
    this.sudoPassword = '';
  }

  private fail(text: string) {
    this.error = text;
  }

  /**
   * A call over the wizard's SSH connection. After a pause SSH may have
   * dropped: connect again first, and retry a read-only call once.
   */
  private async onServer<T>(retry: boolean, call: () => Promise<T>): Promise<T> {
    const target = this.target;
    if (target && Date.now() - this.lastServerReply > SSH_IDLE_MS) await this.reconnect(target);
    let result: T;
    try {
      result = await call();
    } catch (e) {
      const f = e instanceof WizardError ? e.failure : null;
      if (!retry || !target || !f || f.sudo || f.captcha || f.hostKey) throw e;
      await this.reconnect(target);
      result = await call();
    }
    this.lastServerReply = Date.now();
    return result;
  }

  private async reconnect(target: SshTarget) {
    const previous = this.busy;
    this.busy = 'Подключаюсь к серверу заново…';
    this.probe = await unwrap(this.service.connect(target));
    this.lastServerReply = Date.now();
    this.busy = previous;
  }

  /** One call at a time, in the background: the page follows `busy`. */
  private run(message: string, block: () => Promise<void>, onFailure: (f: WizardFailure) => boolean = () => false) {
    if (this.busy) return;
    this.busy = message;
    this.error = null;
    this.notice = null;
    log('info', `мастер: ${message}`);
    void (async () => {
      try {
        await block();
      } catch (e) {
        const text = (e as Error).message || 'Ошибка мастера';
        log('error', `мастер: ${text}`);
        if (!(e instanceof WizardError && onFailure(e.failure))) this.error = text;
      } finally {
        this.busy = null;
      }
    })();
  }
}
