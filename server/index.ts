import fs from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, {type FastifyRequest} from 'fastify';
import {cleanYandexDocument, formatSubscription, fromShare, isLink, siteUrl, telegramUrl} from '../shared/model.js';
import type {
  DiskDoc,
  NodeRecord,
  PanelSettings,
  PanelStatus,
  RemnawaveNode,
  RemnawaveSyncTemplate,
  RemnawaveSyncView,
  SubscriptionFilter,
  SubscriptionPage,
  SubscriptionRecord,
  SubscriptionView,
} from '../shared/panel.js';
import {COOKIE, cookieOptions, isAuthed, login, logout, requireAuth, tooManyAttempts} from './auth.js';
import {corePath, coreVersion, makeLink, readLink} from './core.js';
import {db, docView, documentTakenError, newId, publicNode, setEnvYandexUser, settings} from './db.js';
import {SETTINGS_VARS, SYNC_VARS, type SettingsOverrides, overrides, settingsFromEnv, syncFromEnv} from './overrides.js';
import {env, runtimeDir} from './env.js';
import {log, recentLog} from './log.js';
import {RemnawaveError, listNodes, panelUrl} from './remnawave.js';
import {readSshKey} from './sshkey.js';
import {isActive, store} from './store.js';
import {startBackground, syncNow, syncRunning} from './sync.js';
import {EMOJI_CSS, EMOJI_PARTS, FLAG_FONT, PAGE_CSP, subscriptionPage, wantsPage} from './subpage.js';
import {NodeWizardService} from './wizard/service.js';
import {type CarriersForm, type ServerForm, WizardSession} from './wizard/session.js';
import {DiskError, createDocument, deleteDocument, diskUser, findEditLink} from './yandex.js';

const app = Fastify({logger: false, bodyLimit: 1 << 20, trustProxy: env.trustProxy});
await app.register(cookie);

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

app.setErrorHandler((e: Error, _req, reply) => {
  const status = e instanceof HttpError ? e.status : e instanceof DiskError || e instanceof RemnawaveError ? 502 : ((e as {statusCode?: number}).statusCode ?? 400);
  reply.code(status).send({error: e.message || 'Ошибка'});
});

const body = <T>(req: FastifyRequest) => (req.body ?? {}) as Partial<T>;
const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');

// ---- public: the subscription a Taiga client reads ----

function subscriptionText(s: SubscriptionRecord): string {
  const links = s.nodeIds.map(id => db.node(id)?.link).filter((l): l is string => !!l);
  return formatSubscription(s, links, s.updatedAt || Date.now());
}

const subscriptionUrl = (req: FastifyRequest, token: string) =>
  `${env.publicUrl || `${req.protocol}://${req.host}`}/sub/${token}`;

// Emoji flags as pictures where the system has no flag glyphs (Windows): the panel and the
// subscription page both take the font from here, so only /sub/ has to be public.
app.get('/sub/_/emoji.css', async (_req, reply) =>
  reply.header('Cache-Control', 'public, max-age=86400').type('text/css; charset=utf-8').send(EMOJI_CSS),
);
app.get('/sub/_/emoji/:file', async (req, reply) => {
  const part = EMOJI_PARTS.get((req.params as {file: string}).file);
  if (!part) return reply.code(404).send();
  return reply.header('Cache-Control', 'public, max-age=2592000, immutable').type('font/woff2').send(part);
});
app.get('/sub/_/flags.woff2', async (_req, reply) =>
  reply.header('Cache-Control', 'public, max-age=2592000, immutable').type('font/woff2').send(FLAG_FONT),
);

app.get('/sub/:token', async (req, reply) => {
  const {token} = req.params as {token: string};
  const sub = store.byToken(token);
  if (!sub) return reply.code(404).type('text/plain; charset=utf-8').send('Нет такой подписки\n');
  if (!isActive(sub)) {
    // Still a read: the history shows who keeps asking after the end.
    if (!wantsPage(req.headers.accept, req.query)) store.recordRead(sub.id, req.ip, req.headers['user-agent'] ?? '');
    return reply.code(403).header('Cache-Control', 'no-store').type('text/plain; charset=utf-8').send('Подписка неактивна: продлите её\n');
  }
  reply.header('Vary', 'Accept').header('Referrer-Policy', 'no-referrer').header('X-Robots-Tag', 'noindex, nofollow');
  // A browser gets a page; it is not a client's read, so readAt and reads stay as they are.
  if (wantsPage(req.headers.accept, req.query)) {
    const nodes = sub.nodeIds.map(id => db.node(id)).filter((n): n is NodeRecord => !!n?.link);
    const page = await subscriptionPage(sub, nodes, subscriptionUrl(req, token));
    return reply.header('Cache-Control', 'no-store').header('Content-Security-Policy', PAGE_CSP).type('text/html; charset=utf-8').send(page);
  }
  store.recordRead(sub.id, req.ip, req.headers['user-agent'] ?? '');
  return reply.header('Cache-Control', 'no-store').type('text/plain; charset=utf-8').send(subscriptionText(sub));
});

// ---- auth ----

app.post('/api/login', async (req, reply) => {
  if (tooManyAttempts(req.ip)) throw new HttpError(429, 'Слишком много попыток: подождите минуту');
  const token = login(req.ip, str(body<{password: string}>(req).password, 512));
  if (!token) {
    log('warning', `Неверный пароль с ${req.ip}`);
    throw new HttpError(401, 'Неверный пароль');
  }
  reply.setCookie(COOKIE, token, cookieOptions);
  return {ok: true};
});

app.post('/api/logout', async (req, reply) => {
  logout(req.cookies[COOKIE]);
  reply.clearCookie(COOKIE, {path: '/'});
  return {ok: true};
});

app.get('/api/me', async req => ({authed: isAuthed(req)}));

// ---- everything else needs the admin ----

await app.register(async api => {
  api.addHook('preHandler', requireAuth);

  const viewSub = (req: FastifyRequest, s: SubscriptionRecord): SubscriptionView => ({...s, url: subscriptionUrl(req, s.token), active: isActive(s)});
  /** Refuses to change what .env sets: the page would only be overwritten on the next start. */
  const notFromEnv = (...keys: (keyof SettingsOverrides)[]) => {
    const locked = keys.filter(k => k in overrides.settings);
    if (locked.length) throw new HttpError(409, `Задано в .env (${locked.map(k => SETTINGS_VARS[k]).join(', ')}): меняйте там и перезапустите панель`);
  };
  const yandexToken = () => {
    const token = settings().yandexToken;
    if (!token) throw new HttpError(400, 'Сначала подключите Яндекс Диск в настройках');
    return token;
  };

  api.get('/api/status', async (req): Promise<PanelStatus> => {
    const s = settings();
    return {
      core: {path: env.core, ok: !!corePath(), version: coreVersion()},
      yandex: {connected: !!s.yandexToken, user: s.yandexUser},
      remnawave: {connected: !!s.remnawaveToken, url: s.remnawaveUrl},
      sshKey: !!s.sshPrivateKey,
      publicUrl: env.publicUrl || `${req.protocol}://${req.host}`,
    };
  });

  api.get('/api/log', async () => recentLog());

  // ---- settings ----

  api.get('/api/settings', async (): Promise<PanelSettings> => {
    const {yandexToken: _t, remnawaveToken: _r, sshPrivateKey, sshPassphrase, remnawaveSync: _s, ...rest} = settings();
    return {
      ...rest,
      sshKey: sshPrivateKey ? readSshKey(sshPrivateKey, sshPassphrase) : null,
      fromEnv: Object.fromEntries(settingsFromEnv.map(k => [k, SETTINGS_VARS[k]])),
    };
  });

  // ---- advanced: Remnawave and the SSH key ----

  api.put('/api/settings/remnawave', async req => {
    const b = body<{url: string; token: string}>(req);
    const now = settings();
    // A field .env sets keeps its value; the other one is saved.
    const url = overrides.settings.remnawaveUrl ?? panelUrl(str(b.url, 500));
    const token = overrides.settings.remnawaveToken ?? (str(b.token, 4000).trim() || (url === now.remnawaveUrl ? now.remnawaveToken : ''));
    if (!token) throw new HttpError(400, 'Вставьте API-токен Remnawave');
    const nodes = await listNodes(url, token);
    db.update(d => {
      if (!('remnawaveUrl' in overrides.settings)) d.settings.remnawaveUrl = url;
      if (!('remnawaveToken' in overrides.settings)) d.settings.remnawaveToken = token;
    });
    log('info', `Remnawave подключён: ${new URL(url).host}, нод ${nodes.length}`);
    return {nodes: nodes.length};
  });

  api.delete('/api/settings/remnawave', async () => {
    notFromEnv('remnawaveUrl', 'remnawaveToken');
    db.update(d => Object.assign(d.settings, {remnawaveUrl: '', remnawaveToken: ''}));
    log('info', 'Remnawave отключён');
    return {ok: true};
  });

  api.get('/api/remnawave/nodes', async (): Promise<RemnawaveNode[]> => {
    const {remnawaveUrl, remnawaveToken} = settings();
    if (!remnawaveToken) throw new HttpError(409, 'Remnawave не подключён: добавьте токен в настройках');
    const ours = db.get().nodes;
    return (await listNodes(remnawaveUrl, remnawaveToken)).map(n => {
      const taiga = ours.find(o => o.host && o.host.toLowerCase() === n.address.toLowerCase());
      return {...n, taigaNodeId: taiga?.id ?? '', taigaNodeName: taiga?.name ?? ''};
    });
  });

  api.put('/api/settings/ssh', async req => {
    const b = body<{privateKey: string; passphrase: string; user: string}>(req);
    const user = str(b.user, 64).trim() || 'root';
    if (!/^[a-z_][a-z0-9_.-]*\$?$/i.test(user)) throw new HttpError(400, 'Логин вида root или ubuntu');
    const userFromEnv = 'sshUser' in overrides.settings;
    const privateKey = str(b.privateKey, 16_000).trim();
    if (!privateKey) {
      // Only the login changes; the key stays.
      notFromEnv('sshUser');
      db.update(d => (d.settings.sshUser = user));
      return {ok: true};
    }
    notFromEnv('sshPrivateKey', 'sshPassphrase');
    const passphrase = str(b.passphrase, 1000);
    const info = readSshKey(privateKey, passphrase);
    db.update(d => Object.assign(d.settings, {sshPrivateKey: `${privateKey}\n`, sshPassphrase: passphrase}, userFromEnv ? {} : {sshUser: user}));
    log('info', `SSH-ключ сохранён: ${info.type} ${info.fingerprint}`.trim());
    return info;
  });

  api.delete('/api/settings/ssh', async () => {
    notFromEnv('sshPrivateKey', 'sshPassphrase');
    db.update(d => Object.assign(d.settings, {sshPrivateKey: '', sshPassphrase: ''}));
    log('info', 'SSH-ключ удалён из панели');
    return {ok: true};
  });

  api.put('/api/settings/yandex', async req => {
    notFromEnv('yandexToken');
    const token = str(body<{token: string}>(req).token, 400).trim();
    if (!token) throw new HttpError(400, 'Вставьте OAuth-токен');
    const user = await diskUser(token);
    db.update(d => Object.assign(d.settings, {yandexToken: token, yandexUser: user}));
    log('info', `Яндекс Диск подключён: ${user}`);
    return {user};
  });

  api.delete('/api/settings/yandex', async () => {
    notFromEnv('yandexToken');
    db.update(d => Object.assign(d.settings, {yandexToken: '', yandexUser: ''}));
    return {ok: true};
  });

  api.put('/api/settings', async req => {
    notFromEnv('docsFolder');
    const folder = str(body<{docsFolder: string}>(req).docsFolder, 200).trim();
    if (!/^disk:\/[^\0]*$/.test(folder)) throw new HttpError(400, 'Папка вида disk:/Taiga');
    db.update(d => (d.settings.docsFolder = folder.replace(/\/+$/, '')));
    return {ok: true};
  });

  // ---- Yandex Disk documents ----

  /** The core's own check, as the node sees the document: an anonymous editor. */
  async function checkDoc(doc: DiskDoc) {
    if (!doc.editUrl) return;
    const helper = new NodeWizardService(corePath, (level, text) => log(level, text));
    try {
      const r = await helper.checkDocument(doc.editUrl);
      doc.check = r.ok
        ? {at: Date.now(), status: 'ok', text: 'открывается на редактирование по ссылке'}
        : {at: Date.now(), status: r.captcha ? 'captcha' : 'fail', text: r.error};
    } finally {
      helper.close();
    }
  }

  api.get('/api/docs', async () => db.get().docs.map(docView));

  api.post('/api/docs', async req => {
    const name = str(body<{name: string}>(req).name, 60).trim() || 'taiga';
    const created = await createDocument(yandexToken(), settings().docsFolder, name);
    const doc: DiskDoc = {id: newId(), name, ...created, createdAt: Date.now(), check: null, nodeId: '', nodeName: ''};
    db.update(d => d.docs.unshift(doc));
    log('success', `Документ «${name}» создан`);
    return docView(doc);
  });

  const findDoc = (req: FastifyRequest) => {
    const doc = db.doc((req.params as {id: string}).id);
    if (!doc) throw new HttpError(404, 'Документа больше нет');
    return doc;
  };

  api.post('/api/docs/:id/check', async req => {
    const doc = findDoc(req);
    if (!doc.editUrl) {
      Object.assign(doc, await findEditLink(yandexToken(), doc.path));
    }
    if (!doc.editUrl) throw new HttpError(400, 'Нет ссылки редактирования: вставьте её вручную');
    await checkDoc(doc);
    db.update(() => {});
    return docView(doc);
  });

  api.put('/api/docs/:id', async req => {
    const doc = findDoc(req);
    const clean = cleanYandexDocument(str(body<{editUrl: string}>(req).editUrl));
    if (!clean) throw new HttpError(400, 'Нужна ссылка вида https://docs.yandex.ru/edit/d/…');
    const twin = db.get().docs.find(x => x.id !== doc.id && x.editUrl === clean);
    if (twin) throw new HttpError(409, `Эта ссылка уже у документа «${twin.name}»`);
    doc.editUrl = clean;
    await checkDoc(doc);
    db.update(() => {});
    return docView(doc);
  });

  api.delete('/api/docs/:id', async req => {
    const doc = findDoc(req);
    const token = settings().yandexToken;
    if (token) await deleteDocument(token, doc.path);
    db.update(d => (d.docs = d.docs.filter(x => x.id !== doc.id)));
    log('info', `Документ «${doc.name}» удалён`);
    return {ok: true};
  });

  // ---- nodes ----

  const findNode = (req: FastifyRequest) => {
    const node = db.node((req.params as {id: string}).id);
    if (!node) throw new HttpError(404, 'Ноды больше нет');
    return node;
  };

  api.get('/api/nodes', async () => db.get().nodes.map(publicNode));

  /** Nodes from taiga:// links pasted one a line: the ones made elsewhere. */
  api.post('/api/nodes/import', async req => {
    const lines = str(body<{text: string}>(req).text, 200_000).split(/\s+/).filter(isLink);
    if (!lines.length) throw new HttpError(400, 'Здесь нет ссылок taiga://');
    const added: NodeRecord[] = [];
    const failed: string[] = [];
    for (const link of lines) {
      try {
        const p = fromShare(await readLink(link), newId(), Date.now(), 'link');
        const transports = [{type: p.transport, url: p.value}, ...p.extras.map(e => ({type: e.type, url: e.value}))];
        // Checked against the nodes added from the lines above too: they are saved one by one.
        const taken = transports.filter(t => t.type === 'vyandex').map(t => documentTakenError(t.url)).find(Boolean);
        if (taken) throw new Error(taken);
        const direct = [p, ...p.extras.map(e => ({transport: e.type, value: e.value}))].find(c => c.transport === 'direct');
        const [host, port] = direct ? [direct.value.replace(/:\d+$/, '').replace(/^\[|\]$/g, ''), Number(/:(\d+)$/.exec(direct.value)?.[1] ?? 0)] : ['', 0];
        const node: NodeRecord = {
          id: newId(),
          name: p.name,
          host,
          port,
          channel: '',
          transports: transports.filter(t => t.type !== 'direct'),
          link: link.trim(),
          source: 'link',
          uninstall: '',
          createdAt: Date.now(),
          check: null,
        };
        db.update(d => d.nodes.push(node));
        added.push(node);
      } catch (e) {
        failed.push(`${link.slice(0, 28)}…: ${(e as Error).message}`);
      }
    }
    if (added.length) log('info', `Добавлено нод по ссылкам: ${added.length}`);
    return {added: added.map(publicNode), failed};
  });

  api.get('/api/nodes/:id/link', async req => ({link: findNode(req).link}));

  /** A new name goes into the link too: the client shows the link's name. */
  api.patch('/api/nodes/:id', async req => {
    const node = findNode(req);
    const name = str(body<{name: string}>(req).name, 80).trim();
    if (!name) throw new HttpError(400, 'Укажите название');
    const config = await readLink(node.link);
    const link = await makeLink({...config, name});
    db.update(d => {
      Object.assign(node, {name, link});
      if (settings().remnawaveSync.nodeIds.includes(node.id)) d.settings.remnawaveSync.updatedAt = Date.now();
    });
    store.touchNode(node.id);
    return publicNode(node);
  });

  api.delete('/api/nodes/:id', async req => {
    const node = findNode(req);
    db.update(d => {
      d.nodes = d.nodes.filter(n => n.id !== node.id);
      const t = d.settings.remnawaveSync;
      if (t.nodeIds.includes(node.id)) Object.assign(t, {nodeIds: t.nodeIds.filter(id => id !== node.id), updatedAt: Date.now()});
    });
    store.dropNode(node.id);
    log('info', `Нода «${node.name}» убрана из панели`);
    return {ok: true};
  });

  // ---- subscriptions ----

  const findSub = (req: FastifyRequest) => {
    const sub = store.get((req.params as {id: string}).id);
    if (!sub) throw new HttpError(404, 'Подписки больше нет');
    return sub;
  };
  /** A synced one is the template's and Remnawave's: the panel does not change it by hand. */
  const findManual = (req: FastifyRequest) => {
    const sub = findSub(req);
    if (sub.source !== 'manual') throw new HttpError(409, 'Эта подписка из Remnawave: её меняют шаблон синхронизации и сам Remnawave');
    return sub;
  };

  /** The header fields and nodes from a form, checked the way the client reads them. */
  function subFields(input: Partial<SubscriptionRecord>, nameRequired = true) {
    const name = str(input.name, 80).trim();
    if (!name && nameRequired) throw new HttpError(400, 'Укажите название подписки');
    const telegram = str(input.telegram, 200).trim();
    const site = str(input.site, 200).trim();
    if (telegram && !telegramUrl(telegram)) throw new HttpError(400, 'Telegram: @канал или ссылка t.me');
    if (site && !siteUrl(site)) throw new HttpError(400, 'Сайт: только https');
    const known = new Set(db.get().nodes.map(n => n.id));
    const nodeIds = Array.isArray(input.nodeIds) ? [...new Set(input.nodeIds.filter(id => typeof id === 'string' && known.has(id)))] : [];
    return {name, telegram, site, message: str(input.message, 600), nodeIds};
  }

  const FILTERS: SubscriptionFilter[] = ['all', 'manual', 'remnawave', 'inactive'];

  api.get('/api/subscriptions', async (req): Promise<SubscriptionPage> => {
    const query = req.query as Record<string, string | undefined>;
    const filter = FILTERS.includes(query.filter as SubscriptionFilter) ? (query.filter as SubscriptionFilter) : 'all';
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const page = store.list({search: str(query.q, 100).trim(), filter, offset, limit});
    return {...page, items: page.items.map(s => viewSub(req, s))};
  });

  api.get('/api/subscriptions/:id', async req => viewSub(req, findSub(req)));

  api.get('/api/subscriptions/:id/history', async req => store.history(findSub(req).id));

  api.post('/api/subscriptions', async req => {
    const sub = store.create(subFields(body<SubscriptionRecord>(req)));
    log('info', `Подписка «${sub.name}» создана`);
    return viewSub(req, sub);
  });

  api.put('/api/subscriptions/:id', async req => {
    const sub = findManual(req);
    return viewSub(req, store.update(sub.id, subFields(body<SubscriptionRecord>(req))));
  });

  /** A new secret: the old URL stops working for everyone who had it. */
  api.post('/api/subscriptions/:id/rotate', async req => {
    const sub = findManual(req);
    log('warning', `Подписка «${sub.name}»: адрес заменён`);
    return viewSub(req, store.rotate(sub.id));
  });

  api.get('/api/subscriptions/:id/text', async req => ({text: subscriptionText(findSub(req))}));

  api.delete('/api/subscriptions/:id', async req => {
    const sub = findManual(req);
    store.remove(sub.id);
    log('info', `Подписка «${sub.name}» удалена`);
    return {ok: true};
  });

  // ---- Remnawave sync: a subscription per user ----

  const syncView = (): RemnawaveSyncView => {
    const {updatedAt: _u, envHash: _h, ...rest} = settings().remnawaveSync;
    return {...rest, running: syncRunning(), fromEnv: Object.fromEntries(syncFromEnv.map(k => [k, SYNC_VARS[k]]))};
  };

  api.get('/api/remnawave/sync', async () => syncView());

  api.put('/api/remnawave/sync', async req => {
    const b = body<RemnawaveSyncTemplate>(req);
    const fields = {...subFields(b, false), enabled: !!b.enabled};
    fields.name ||= 'Taiga';
    // Fields .env sets stay as they are; the rest is saved.
    for (const k of syncFromEnv) delete (fields as Partial<typeof fields>)[k];
    const enabled = fields.enabled ?? settings().remnawaveSync.enabled;
    if (enabled && !settings().remnawaveToken) throw new HttpError(409, 'Сначала подключите Remnawave в настройках');
    db.update(d => Object.assign(d.settings.remnawaveSync, fields, {updatedAt: Date.now()}));
    log('info', enabled ? 'Синхронизация с Remnawave включена' : 'Синхронизация с Remnawave выключена');
    if (enabled) void syncNow();
    return syncView();
  });

  api.post('/api/remnawave/sync', async () => {
    await syncNow();
    return syncView();
  });

  // ---- node wizard: one at a time, the admin's ----

  let wizard: WizardSession | null = null;
  const current = () => {
    if (!wizard) throw new HttpError(409, 'Мастер не запущен');
    return wizard;
  };

  api.get('/api/wizard', async () => (wizard ? wizard.view() : null));

  api.post('/api/wizard/start', async req => {
    const force = !!body<{force: boolean}>(req).force;
    if (wizard?.unsaved && !force) throw new HttpError(409, 'Предыдущая нода установлена, но не сохранена');
    wizard?.close();
    wizard = new WizardSession();
    return wizard.view();
  });

  api.post('/api/wizard/:action', async req => {
    const w = current();
    const b = body<Record<string, unknown>>(req);
    switch ((req.params as {action: string}).action) {
      case 'connect':
        w.connect(b as unknown as ServerForm);
        break;
      case 'trust':
        w.trustHostKey();
        break;
      case 'reject':
        w.rejectHostKey();
        break;
      case 'next':
        w.next(b as unknown as CarriersForm);
        break;
      case 'auto-update':
        w.setAutoUpdate(!!b.on);
        break;
      case 'back':
        w.back();
        break;
      case 'install':
        w.install(str(b.sudoPassword, 512));
        break;
      case 'verify':
        w.verify();
        break;
      case 'skip':
        w.skipVerification();
        break;
      case 'remove':
        w.removeChannel(str(b.sudoPassword, 512));
        break;
      case 'save':
        w.save();
        break;
      case 'close':
        if (w.unsaved && !b.force) throw new HttpError(409, 'Нода установлена, но не сохранена');
        w.close();
        wizard = null;
        return null;
      default:
        throw new HttpError(404, 'Нет такого действия');
    }
    return w.view();
  });
});

// ---- the pages, built ----

const webDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../web');
if (fs.existsSync(path.join(webDir, 'index.html'))) {
  await app.register(fastifyStatic, {root: webDir, wildcard: false});
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({error: 'Нет такого адреса'});
    return reply.sendFile('index.html');
  });
}

// SYNC_NODES names nodes the panel may not have: say so instead of dropping them quietly.
{
  const nodes = db.get().nodes;
  const unknown = (overrides.sync.nodes ?? []).filter(ref => !nodes.some(n => n.id === ref || n.name === ref));
  if (unknown.length) log('warning', `SYNC_NODES из .env: таких нод в панели нет: ${unknown.join(', ')}`);
}

// Whose Disk YANDEX_TOKEN opens, for the page: a refusal goes to the journal, the panel still starts.
if (overrides.settings.yandexToken) {
  diskUser(overrides.settings.yandexToken).then(setEnvYandexUser, e => log('warning', `YANDEX_TOKEN из .env: ${(e as Error).message}`));
}
startBackground();

const shutdown = () => {
  fs.rmSync(runtimeDir, {recursive: true, force: true});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({host: env.host, port: env.port});
log('info', `Панель Taiga: http://${env.host}:${env.port} (ядро: ${corePath() ? env.core : 'не найдено'})`);
