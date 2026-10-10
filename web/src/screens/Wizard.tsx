import {ArrowLeftIcon, ArrowRightIcon, CheckCircleIcon, FilePlusIcon, FileTextIcon, KeyIcon, LockSimpleIcon, ShieldWarningIcon} from '@phosphor-icons/react';
import {type ReactNode, useCallback, useEffect, useRef, useState} from 'react';
import {TRANSPORTS, describeCarriers} from '../../../shared/model';
import type {DiskDoc, PanelStatus, WizardStep, WizardView} from '../../../shared/panel';
import {ApiError, get, post} from '../api';
import {go} from '../App';
import {Banner, Button, Confirm, CopyLine, Field, Input, PageHead, Panel, StatusMark, TextArea, Toggle, useToast} from '../components/ui';
import {flagged, useRemnawaveNodes} from './Advanced';
import {createDoc} from './Docs';

const STEPS: {step: WizardStep; label: string}[] = [
  {step: 'server', label: 'Сервер'},
  {step: 'transports', label: 'Транспорты'},
  {step: 'plan', label: 'Установка'},
  {step: 'verify', label: 'Проверка'},
  {step: 'done', label: 'Готово'},
];

/** The wizard lives on the server; the page shows it and sends what the admin typed. */
export function Wizard({status}: {status: PanelStatus | null}) {
  const [view, setView] = useState<WizardView | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [leave, setLeave] = useState<'close' | 'restart' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      setView(await get<WizardView | null>('/api/wizard'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);

  // While the server works, follow it.
  useEffect(() => {
    if (!view?.busy) return;
    timer.current = setTimeout(refresh, 700);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [view, refresh]);

  const send = useCallback(async (action: string, body: object = {}) => {
    setError('');
    try {
      setView(await post<WizardView>(`/api/wizard/${action}`, body));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const start = async (force = false) => {
    setError('');
    try {
      setView(await post<WizardView>('/api/wizard/start', {force}));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setLeave('restart');
      else setError((e as Error).message);
    }
  };

  const close = async (force = false) => {
    try {
      await post('/api/wizard/close', {force});
      setView(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setLeave('close');
      else setError((e as Error).message);
    }
  };

  if (view === undefined) return null;

  return (
    <>
      <PageHead
        title="Своя нода"
        sub="Ставит выход на ваш VDS по SSH: документ Яндекса, Mail.ru или комнаты cups.online и всегда Direct в резерве. Повторный запуск добавляет на тот же сервер ещё один канал."
        actions={view && <Button onClick={() => close()}>Закрыть мастер</Button>}
      />
      {status && !status.core.ok && (
        <div className="mb-6">
          <Banner tone="error">Ядро не найдено ({status.core.path}). Укажите путь в TAIGA_CORE и перезапустите панель.</Banner>
        </div>
      )}
      {error && (
        <div className="mb-6">
          <Banner tone="error" onClose={() => setError('')}>
            {error}
          </Banner>
        </div>
      )}
      {!view ? (
        <Panel>
          <div className="grid gap-6 md:grid-cols-[1.4fr_1fr] md:items-center">
            <div className="grid gap-3">
              <h2 className="font-display text-2xl text-ink">Нужен сервер с Linux и systemd</h2>
              <p className="text-dim leading-relaxed max-w-[60ch]">
                Мастер подключится по SSH паролем или ключом, покажет, что изменится на сервере, поставит канал и проверит его запросом через ноду. Пароли живут только в памяти панели, пока открыт мастер.
              </p>
            </div>
            <Button tone="acid" onClick={() => start()} disabled={!status?.core.ok} className="md:justify-self-end">
              Начать <ArrowRightIcon size={16} weight="bold" />
            </Button>
          </div>
        </Panel>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
          <ol className="flex lg:flex-col gap-1 overflow-x-auto" aria-label="Шаги">
            {STEPS.map((s, i) => {
              const at = STEPS.findIndex(x => x.step === view.step);
              const state = i < at ? 'past' : i === at ? 'now' : 'next';
              return (
                <li
                  key={s.step}
                  aria-current={state === 'now' ? 'step' : undefined}
                  className={`flex items-center gap-3 px-3 h-10 shrink-0 text-[13px] border-l-2 ${
                    state === 'now' ? 'border-acid text-acid bg-acid/5' : state === 'past' ? 'border-ok/60 text-ink' : 'border-wire text-dim'
                  }`}
                >
                  <span className="font-semibold tabular-nums">{state === 'past' ? '✓' : `0${i + 1}`}</span>
                  {s.label}
                </li>
              );
            })}
          </ol>
          <div className="grid gap-4 content-start">
            {view.busy && (
              <div className="chamfer-sm scan bg-cyan/10 text-cyan px-4 py-3" role="status">
                {view.busy}
                <span className="blink">_</span>
              </div>
            )}
            {view.error && <Banner tone="error">{view.error}</Banner>}
            {view.notice && <Banner tone="ok">{view.notice}</Banner>}
            {view.step === 'server' && <ServerStep view={view} send={send} status={status} />}
            {view.step === 'transports' && <TransportsStep view={view} send={send} yandex={!!status?.yandex.connected} />}
            {view.step === 'plan' && <PlanStep view={view} send={send} />}
            {(view.step === 'verify' || view.step === 'done') && <ResultStep view={view} send={send} onNew={() => start()} />}
          </div>
        </div>
      )}
      {leave && (
        <Confirm
          title="Нода не сохранена"
          confirm={leave === 'close' ? 'Закрыть всё равно' : 'Начать заново'}
          onCancel={() => setLeave(null)}
          onConfirm={() => {
            const what = leave;
            setLeave(null);
            void (what === 'close' ? close(true) : start(true));
          }}
        >
          Канал уже стоит на сервере, но панель его не запомнила, и его ссылка потеряется. Сохраните ноду или удалите канал с сервера на последнем шаге.
        </Confirm>
      )}
    </>
  );
}

type Send = (action: string, body?: object) => Promise<void>;

function StepFrame({title, children, footer}: {title: string; children: ReactNode; footer: ReactNode}) {
  return (
    <Panel className="rise">
      <div className="grid gap-6">
        <h2 className="font-display text-2xl text-ink">{title}</h2>
        {children}
        <div className="flex flex-wrap justify-between gap-2 pt-2 border-t border-wire/70">{footer}</div>
      </div>
    </Panel>
  );
}

function ServerStep({view, send, status}: {view: WizardView; send: Send; status: PanelStatus | null}) {
  const saved = !!view.savedKey;
  const [form, setForm] = useState({
    host: view.host,
    port: view.port,
    // A fresh wizard takes the login that goes with the saved key.
    user: saved && !view.host ? view.savedKeyUser : view.user,
    useKey: saved,
    useSavedKey: saved,
    password: '',
    privateKey: '',
    passphrase: '',
  });
  const set = (patch: Partial<typeof form>) => setForm(f => ({...f, ...patch}));
  const keyFile = useRef<HTMLInputElement>(null);
  const remnawave = useRemnawaveNodes(!!status?.remnawave.connected);
  const [nodeQuery, setNodeQuery] = useState('');
  const q = nodeQuery.trim().toLowerCase();
  const shownNodes = remnawave.nodes?.filter(n => !q || `${n.name} ${n.address} ${n.countryCode}`.toLowerCase().includes(q)) ?? [];
  const ready = form.host.trim() && form.user.trim() && (form.useKey ? form.useSavedKey || form.privateKey.trim() : form.password);

  return (
    <>
      <StepFrame
        title="Сервер"
        footer={
          <>
            <span />
            <Button tone="acid" busy={!!view.busy} disabled={!ready} onClick={() => send('connect', form)}>
              Подключиться <ArrowRightIcon size={16} weight="bold" />
            </Button>
          </>
        }
      >
        {view.knownServers.length > 0 && (
          <div className="flex flex-wrap gap-2" aria-label="Серверы, на которые ставили раньше">
            {view.knownServers.map(s => (
              <button
                key={`${s.host}:${s.port}`}
                onClick={() => set({host: s.host, port: String(s.port), user: s.user})}
                className="chamfer-sm px-3 py-1 text-[12px] bg-wire/50 text-dim hover:text-acid"
              >
                {s.user}@{s.host}
                {s.port !== 22 && `:${s.port}`}
              </button>
            ))}
          </div>
        )}
        {status?.remnawave.connected && (
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-dim text-[12px] uppercase tracking-[0.14em]">Ноды Remnawave {remnawave.nodes ? `· ${remnawave.nodes.length}` : ''}</span>
              {(remnawave.nodes?.length ?? 0) > 12 && (
                <Input value={nodeQuery} onChange={e => setNodeQuery(e.target.value)} placeholder="Найти: страна, имя, адрес" aria-label="Найти ноду" className="!h-8 !w-56 text-[12px]" />
              )}
            </div>
            {remnawave.error && <p className="text-bad text-[13px]">{remnawave.error}</p>}
            {remnawave.loading && !remnawave.nodes && <p className="text-dim text-[13px]">Загружаю список…</p>}
            {remnawave.nodes?.length === 0 && <p className="text-dim text-[13px]">В Remnawave пока нет нод.</p>}
            {!!remnawave.nodes?.length && (
              <div className="flex flex-wrap content-start gap-2 max-h-40 overflow-y-auto pr-1 [scrollbar-width:thin]" aria-label="Ноды из Remnawave">
                {!shownNodes.length && <p className="text-dim text-[13px]">Ничего не нашлось.</p>}
                {shownNodes.map(n => (
                  <button
                    key={n.uuid}
                    type="button"
                    onClick={() => set({host: n.address, port: '22', ...(form.useKey && form.useSavedKey ? {user: view.savedKeyUser} : {})})}
                    title={n.taigaNodeId ? `Taiga уже стоит: ${n.taigaNodeName}` : n.address}
                    aria-pressed={form.host === n.address}
                    className={`chamfer-sm px-3 py-1 text-[12px] bg-wire/50 hover:text-acid ${form.host === n.address ? 'text-acid' : 'text-dim'}`}
                  >
                    {flagged(n)}
                    {n.taigaNodeId && <span className="text-ok"> · Taiga</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="grid gap-5 md:grid-cols-[1fr_120px_1fr]">
          <Field label="Адрес сервера">
            {id => <Input id={id} value={form.host} onChange={e => set({host: e.target.value})} placeholder="203.0.113.5" autoFocus />}
          </Field>
          <Field label="Порт SSH">
            {id => <Input id={id} value={form.port} inputMode="numeric" onChange={e => set({port: e.target.value})} />}
          </Field>
          <Field label="Логин">
            {id => <Input id={id} value={form.user} onChange={e => set({user: e.target.value})} autoComplete="username" />}
          </Field>
        </div>
        <Toggle
          checked={form.useKey}
          onChange={useKey => set({useKey})}
          label="Вход по ключу"
          hint={saved ? 'Иначе по паролю. Пароль не сохраняется.' : 'Иначе по паролю. Ключ и пароль не сохраняются: постоянный ключ задаётся в настройках.'}
        />
        {form.useKey && saved && (
          <Toggle
            checked={form.useSavedKey}
            onChange={useSavedKey => set({useSavedKey})}
            label="Сохранённый ключ"
            hint={<span className="break-all">{view.savedKey}</span>}
          />
        )}
        {form.useKey && form.useSavedKey && saved ? null : form.useKey ? (
          <div className="grid gap-5">
            <Field
              label="Приватный ключ"
              hint={
                <>
                  OpenSSH или PEM.{' '}
                  <button type="button" className="text-acid underline underline-offset-4" onClick={() => keyFile.current?.click()}>
                    Выбрать файл
                  </button>
                </>
              }
            >
              {id => <TextArea id={id} rows={5} value={form.privateKey} onChange={e => set({privateKey: e.target.value})} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" spellCheck={false} />}
            </Field>
            <input
              ref={keyFile}
              type="file"
              className="hidden"
              onChange={async e => {
                const file = e.target.files?.[0];
                if (file && file.size < 64 * 1024) set({privateKey: await file.text()});
                e.target.value = '';
              }}
            />
            <Field label="Пароль ключа" hint="Если ключ зашифрован.">
              {id => <Input id={id} type="password" value={form.passphrase} onChange={e => set({passphrase: e.target.value})} autoComplete="off" />}
            </Field>
          </div>
        ) : (
          <Field label="Пароль SSH">
            {id => <Input id={id} type="password" value={form.password} onChange={e => set({password: e.target.value})} autoComplete="off" />}
          </Field>
        )}
      </StepFrame>
      {view.hostKeyPrompt && (
        <Confirm
          title={view.hostKeyPrompt.mismatch ? 'Ключ сервера изменился' : 'Новый сервер'}
          confirm={view.hostKeyPrompt.mismatch ? 'Доверять новому ключу' : 'Доверять'}
          tone={view.hostKeyPrompt.mismatch ? 'danger' : 'acid'}
          onCancel={() => send('reject')}
          onConfirm={() => send('trust')}
        >
          <div className="grid gap-3">
            {view.hostKeyPrompt.mismatch ? (
              <p className="flex gap-2 text-bad">
                <ShieldWarningIcon size={20} className="shrink-0" />
                Отпечаток не совпадает с запомненным. Так бывает после переустановки сервера, но так же выглядит и перехват соединения.
              </p>
            ) : (
              <p>Сверьте отпечаток ключа с тем, что показывает панель хостера или команда ssh-keygen -lf на сервере.</p>
            )}
            <p className="chamfer-sm bg-void px-3 py-2 text-cyan text-[12px] break-all flex gap-2">
              <KeyIcon size={16} className="shrink-0" />
              {view.hostKeyPrompt.fingerprint}
            </p>
          </div>
        </Confirm>
      )}
    </>
  );
}

function TransportsStep({view, send, yandex}: {view: WizardView; send: Send; yandex: boolean}) {
  const [form, setForm] = useState({
    name: view.name,
    useVolga: view.useVolga,
    useMailru: view.useMailru,
    useCups: view.useCups,
    documentUrl: view.documentUrl,
    docId: view.docId,
    mailruInput: view.mailruInput,
  });
  const [creating, setCreating] = useState(false);
  const [docError, setDocError] = useState('');
  const [docs, setDocs] = useState<DiskDoc[]>([]);
  const toast = useToast();
  const set = (patch: Partial<typeof form>) => setForm(f => ({...f, ...patch}));
  useEffect(() => void get<DiskDoc[]>('/api/docs').then(setDocs, () => {}), []);
  const typed = form.documentUrl.trim().replace(/[?#].*$/, '');
  const takenBy = docs.find(d => d.nodeId && d.editUrl === typed);

  const makeDoc = async () => {
    setCreating(true);
    setDocError('');
    try {
      const doc = await createDoc(form.name.trim() || `node-${view.host}`);
      setDocs(list => [doc, ...list]);
      if (doc.editUrl) {
        set({documentUrl: doc.editUrl, docId: doc.id});
        toast('Документ создан');
      } else {
        set({docId: doc.id});
        setDocError('Документ создан, но Диск не отдал ссылку редактирования. Откройте его в разделе «Документы», включите редактирование по ссылке и вставьте её сюда.');
      }
    } catch (e) {
      setDocError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const probe = view.probe;
  const types = [form.useVolga && 'vyandex', form.useMailru && 'mailru', form.useCups && 'cupsonline'].filter(Boolean) as (keyof typeof TRANSPORTS)[];

  return (
    <StepFrame
      title="Транспорты канала"
      footer={
        <>
          <Button onClick={() => send('back')} disabled={!!view.busy}>
            <ArrowLeftIcon size={16} /> Назад
          </Button>
          <Button tone="acid" busy={!!view.busy} onClick={() => send('next', form)}>
            Дальше <ArrowRightIcon size={16} weight="bold" />
          </Button>
        </>
      }
    >
      {probe && (
        <p className="text-[12px] text-dim">
          {view.user}@{view.host}: {probe.os ?? 'linux'} {probe.arch}, systemd {probe.systemd ? 'есть' : 'нет'}, sudo {probe.sudo}
          {probe.core && `, ядро ${probe.core}`}
          {probe.channels?.length ? `, каналов уже ${probe.channels.length}` : ''} · новый канал {view.channel}
        </p>
      )}
      <Field label="Название ноды" hint="Так нода будет называться в панели и у клиентов.">
        {id => <Input id={id} value={form.name} maxLength={80} onChange={e => set({name: e.target.value})} />}
      </Field>
      <div className="grid gap-5">
        <Toggle checked={form.useVolga} onChange={useVolga => set({useVolga})} label="Документ Яндекса (Volga)" hint="Основной транспорт. Нужен свой документ, открытый на редактирование по ссылке." />
        {form.useVolga && (
          <div className="grid gap-3 pl-8">
            <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-start">
              <Field label="Ссылка на документ" error={docError}>
                {id => <Input id={id} value={form.documentUrl} onChange={e => set({documentUrl: e.target.value, docId: ''})} placeholder="https://docs.yandex.ru/edit/d/…" spellCheck={false} />}
              </Field>
              <Button className="md:mt-[26px]" onClick={makeDoc} busy={creating} disabled={!yandex} title={yandex ? '' : 'Подключите Яндекс Диск в настройках'}>
                <FilePlusIcon size={16} /> Создать на Диске
              </Button>
            </div>
            {!yandex && (
              <p className="text-[12px] text-dim">
                Чтобы создавать документы отсюда,{' '}
                <button className="text-acid underline underline-offset-4" onClick={() => go('settings')}>
                  подключите Яндекс Диск
                </button>
                .
              </p>
            )}
            {takenBy && <Banner tone="warn">Этот документ уже канал ноды «{takenBy.nodeName}». У каждой ноды свой документ: выберите свободный или создайте новый.</Banner>}
            <DocPicker docs={docs} selected={typed} onPick={d => set({documentUrl: d.editUrl, docId: d.id})} />
            {view.documentWarning && <Banner tone="warn">{view.documentWarning}</Banner>}
          </div>
        )}
        <Toggle checked={form.useMailru} onChange={useMailru => set({useMailru})} label="Документ Mail.ru" hint="Публичная ссылка на документ в Облаке Mail.ru с правом редактирования." />
        {form.useMailru && (
          <div className="pl-8">
            <Field label="Ссылка Mail.ru">
              {id => <Input id={id} value={form.mailruInput} onChange={e => set({mailruInput: e.target.value})} placeholder="https://cloud.mail.ru/public/…/…" spellCheck={false} />}
            </Field>
          </div>
        )}
        <Toggle checked={form.useCups} onChange={useCups => set({useCups})} label="Комнаты cups.online" hint="Панель создаст комнаты сама." />
      </div>
      <p className="text-dim">
        Канал пойдёт через <span className="text-ink">{describeCarriers(types)}</span>.
      </p>
    </StepFrame>
  );
}

/** The panel's documents: a free one can be taken, a busy one shows whose channel it is. */
function DocPicker({docs, selected, onPick}: {docs: DiskDoc[]; selected: string; onPick: (d: DiskDoc) => void}) {
  const usable = docs.filter(d => d.editUrl);
  if (!usable.length) return null;
  const free = usable.filter(d => !d.nodeId).length;
  return (
    <div className="grid gap-2">
      <p className="text-[12px] text-dim">
        Документы панели: свободных {free} из {usable.length}. Один документ — одна нода.
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {usable.map(d => {
          const picked = d.editUrl === selected;
          return (
            <li key={d.id}>
              <button
                type="button"
                disabled={!!d.nodeId}
                aria-pressed={picked}
                onClick={() => onPick(d)}
                className={`chamfer-sm w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] ${
                  d.nodeId ? 'bg-wire/30 text-dim cursor-not-allowed' : picked ? 'bg-acid/20 text-acid' : 'bg-wire/50 text-ink hover:bg-wire/80'
                }`}
              >
                {d.nodeId ? <LockSimpleIcon size={14} className="shrink-0" /> : picked ? <CheckCircleIcon size={14} weight="fill" className="shrink-0" /> : <FileTextIcon size={14} className="shrink-0" />}
                <span className="truncate">{d.name}</span>
                <span className="ml-auto shrink-0 text-dim">{d.nodeId ? `нода «${d.nodeName}»` : picked ? 'выбран' : 'свободен'}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PlanStep({view, send}: {view: WizardView; send: Send}) {
  const [sudo, setSudo] = useState('');
  const plan = view.plan;
  return (
    <StepFrame
      title="Что изменится на сервере"
      footer={
        <>
          <Button onClick={() => send('back')} disabled={!!view.busy}>
            <ArrowLeftIcon size={16} /> Назад
          </Button>
          <Button tone="acid" busy={!!view.busy} disabled={view.needsSudoPassword && !sudo && !view.installed} onClick={() => send('install', {sudoPassword: sudo})}>
            Установить
          </Button>
        </>
      }
    >
      {plan && (
        <div className="grid gap-5 md:grid-cols-2">
          <div className="grid gap-2 content-start">
            <p className="text-[12px] uppercase tracking-[0.12em] text-dim">Сделает</p>
            <ul className="grid gap-2">
              {(plan.actions ?? []).map((a, i) => (
                <li key={i} className="flex gap-2 leading-relaxed">
                  <span className="text-acid">&gt;</span>
                  {a}
                </li>
              ))}
            </ul>
          </div>
          {!!plan.untouched?.length && (
            <div className="grid gap-2 content-start">
              <p className="text-[12px] uppercase tracking-[0.12em] text-dim">Не тронет</p>
              <ul className="grid gap-2 text-dim">
                {plan.untouched.map((a, i) => (
                  <li key={i} className="leading-relaxed">
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <p className="text-[12px] text-dim">
        Канал {plan?.channel ?? view.channel}, порт Direct {plan?.port}
        {plan?.core && `, ядро ${plan.core}`}
      </p>
      <Toggle
        checked={view.autoUpdate}
        onChange={on => send('auto-update', {on})}
        disabled={!!view.busy}
        label="Обновлять ядро на сервере само"
        hint="Один таймер systemd на все каналы сервера."
      />
      {view.needsSudoPassword && (
        <Field label="Пароль sudo" hint="Сервер просит пароль для sudo. Подставлен пароль SSH, если входили по паролю.">
          {id => <Input id={id} type="password" value={sudo} onChange={e => setSudo(e.target.value)} autoComplete="off" />}
        </Field>
      )}
    </StepFrame>
  );
}

function ResultStep({view, send, onNew}: {view: WizardView; send: Send; onNew: () => void}) {
  const [sudo, setSudo] = useState('');
  const [removeAsk, setRemoveAsk] = useState(false);
  const verifying = view.step === 'verify' && !view.verifyFailed;
  return (
    <StepFrame
      title={view.step === 'done' ? 'Нода готова' : 'Проверка через ноду'}
      footer={
        view.savedNodeId ? (
          <>
            <Button onClick={onNew}>Ещё одна нода</Button>
            <div className="flex gap-2">
              <Button onClick={() => go('nodes')}>К нодам</Button>
              <Button tone="acid" onClick={() => go('subs')}>
                Добавить в подписку <ArrowRightIcon size={16} weight="bold" />
              </Button>
            </div>
          </>
        ) : (
          <>
            {view.installed ? (
              <Button tone="danger" onClick={() => setRemoveAsk(true)} disabled={!!view.busy}>
                Удалить канал с сервера
              </Button>
            ) : (
              <span />
            )}
            <div className="flex flex-wrap gap-2">
              {view.verifyFailed && (
                <>
                  <Button onClick={() => send('verify')} disabled={!!view.busy}>
                    Проверить снова
                  </Button>
                  <Button onClick={() => send('skip')} disabled={!!view.busy}>
                    Пропустить проверку
                  </Button>
                </>
              )}
              {view.installed && (
                <Button tone="acid" onClick={() => send('save')} disabled={verifying || !!view.busy}>
                  <CheckCircleIcon size={16} weight="bold" /> Сохранить ноду
                </Button>
              )}
            </div>
          </>
        )
      }
    >
      <div className="grid gap-3">
        {verifying && <StatusMark status="live">поднимаю ядро на сервере панели и жду ответа ноды, до 90 с</StatusMark>}
        {view.verifiedIp && (
          <StatusMark status="ok">
            трафик выходит с {view.verifiedIp}, {view.verifyMs} мс{view.verifyVia.length ? `, транспорты: ${view.verifyVia.join(', ')}` : ''}
          </StatusMark>
        )}
        {view.verifyFailed && <Banner tone="warn">{view.verifyFailed}</Banner>}
        {view.step === 'done' && !view.verifiedIp && <StatusMark status="warn">проверка пропущена: проверьте ноду позже в разделе «Ноды»</StatusMark>}
        {view.savedNodeId && <Banner tone="ok">Нода сохранена в панели. Добавьте её в подписку, и клиенты получат её при следующем обновлении.</Banner>}
      </div>
      {view.uninstallCommand && (
        <div className="grid gap-2">
          <p className="text-[12px] uppercase tracking-[0.12em] text-dim">Удаление на сервере без панели</p>
          <CopyLine value={view.uninstallCommand} />
        </div>
      )}
      {view.uninstallError && <p className="text-[12px] text-warn">Команду удаления оставить не удалось: {view.uninstallError}</p>}
      {removeAsk && (
        <Confirm
          title="Удалить канал с сервера?"
          confirm="Удалить"
          onCancel={() => setRemoveAsk(false)}
          onConfirm={() => {
            setRemoveAsk(false);
            void send('remove', {sudoPassword: sudo});
          }}
        >
          <p className="mb-4">Канал {view.channel} остановится и удалится с {view.host}. Другие каналы сервера останутся.</p>
          {view.needsSudoPassword && (
            <Field label="Пароль sudo">
              {id => <Input id={id} type="password" value={sudo} onChange={e => setSudo(e.target.value)} autoComplete="off" />}
            </Field>
          )}
        </Confirm>
      )}
    </StepFrame>
  );
}
