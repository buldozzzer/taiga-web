import {ArrowsClockwiseIcon, CaretDownIcon, EyeIcon, MagnifyingGlassIcon, PencilSimpleIcon, PlusIcon, TrashIcon} from '@phosphor-icons/react';
import {useCallback, useEffect, useState} from 'react';
import {TRANSPORTS, plural} from '../../../shared/model';
import type {
  NodeView,
  PanelStatus,
  RemnawaveSyncView,
  SubscriptionFilter,
  SubscriptionHistory,
  SubscriptionPage,
  SubscriptionView,
} from '../../../shared/panel';
import {ago, del, get, post, put} from '../api';
import {go} from '../App';
import {Banner, Button, Confirm, CopyLine, EnvNote, Empty, Field, IconButton, Input, PageHead, Panel, Skeleton, StatusMark, TextArea, Toggle, useToast} from '../components/ui';

type Draft = Pick<SubscriptionView, 'name' | 'telegram' | 'site' | 'message' | 'nodeIds'> & {id?: string};
const EMPTY: Draft = {name: '', telegram: '', site: '', message: '', nodeIds: []};
const PAGE_SIZE = 50;

const FILTERS: {key: SubscriptionFilter; label: string}[] = [
  {key: 'all', label: 'Все'},
  {key: 'manual', label: 'Свои'},
  {key: 'remnawave', label: 'Remnawave'},
  {key: 'inactive', label: 'Неактивные'},
];

const STATUS_RU: Record<string, string> = {ACTIVE: 'активна', DISABLED: 'отключена', LIMITED: 'лимит трафика', EXPIRED: 'истекла'};

const subTitle = (s: SubscriptionView) => (s.source === 'remnawave' ? s.remnawave?.username || 'без имени' : s.name);

export function Subscriptions({status}: {status: PanelStatus | null}) {
  const [page, setPage] = useState<SubscriptionPage | null>(null);
  const [nodes, setNodes] = useState<NodeView[]>([]);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SubscriptionFilter>('all');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({q: query, filter, offset: String(offset), limit: String(PAGE_SIZE)});
      const [p, n] = await Promise.all([get<SubscriptionPage>(`/api/subscriptions?${params}`), get<NodeView[]>('/api/nodes')]);
      setPage(p);
      setNodes(n);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [query, filter, offset]);
  useEffect(() => void load(), [load]);

  // The search goes to the server a moment after typing stops.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setError('');
    try {
      await fn();
      if (done) toast(done);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const empty = page && page.counts.all === 0 && !query;

  return (
    <>
      <PageHead
        title="Подписки"
        sub="Клиент Taiga добавляет подписку по адресу и сам подтягивает новые ноды, изменения и сообщения."
        actions={
          <Button tone="acid" onClick={() => setDraft({...EMPTY})}>
            <PlusIcon size={16} weight="bold" /> Новая подписка
          </Button>
        }
      />
      {error && (
        <div className="mb-6">
          <Banner tone="error" onClose={() => setError('')}>
            {error}
          </Banner>
        </div>
      )}
      {status?.remnawave.connected && <SyncPanel nodes={nodes} publicUrl={status.publicUrl} onSynced={load} onError={setError} />}
      {draft && (
        <Panel className="mb-6 rise">
          <Editor
            title={draft.id ? 'Подписка' : 'Новая подписка'}
            draft={draft}
            nodes={nodes}
            onCancel={() => setDraft(null)}
            onSave={d =>
              act(async () => {
                await (d.id ? put(`/api/subscriptions/${d.id}`, d) : post('/api/subscriptions', d));
                setDraft(null);
              }, d.id ? 'Подписка сохранена' : 'Подписка создана')
            }
          />
        </Panel>
      )}
      {!page ? (
        <Skeleton />
      ) : empty && !draft ? (
        <Empty
          title="Подписок пока нет"
          action={
            <div className="flex flex-wrap gap-2">
              <Button tone="acid" onClick={() => setDraft({...EMPTY})}>
                Создать подписку
              </Button>
              {!nodes.length && <Button onClick={() => go('wizard')}>Сначала поставить ноду</Button>}
            </div>
          }
        >
          Подписка: адрес, который вы раздаёте пользователям. В нём лежат ссылки на выбранные ноды, а клиент Taiga перечитывает его при каждом запуске. Подписки
          для пользователей Remnawave создаёт синхронизация: подключите Remnawave в настройках.
        </Empty>
      ) : (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative flex-1 min-w-[220px]">
              <span className="sr-only">Поиск</span>
              <MagnifyingGlassIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Имя, пользователь, Telegram ID, почта" className="pl-9" />
            </label>
            <div className="grid grid-cols-2 sm:flex gap-1 w-full sm:w-auto" role="tablist" aria-label="Какие подписки">
              {FILTERS.map(f => (
                <button
                  key={f.key}
                  role="tab"
                  aria-selected={filter === f.key}
                  onClick={() => {
                    setFilter(f.key);
                    setOffset(0);
                  }}
                  className={`chamfer-sm h-10 px-3 text-[12px] whitespace-nowrap ${filter === f.key ? 'bg-acid/15 text-acid' : 'bg-wire/40 text-dim hover:text-ink'}`}
                >
                  {f.label} <span className="opacity-70">{page.counts[f.key]}</span>
                </button>
              ))}
            </div>
          </div>
          {page.items.length === 0 ? (
            <p className="text-dim py-6">Ничего не нашлось.</p>
          ) : (
            <Panel flush>
              <ul>
                {page.items.map(s => (
                  <SubscriptionRow
                    key={s.id}
                    sub={s}
                    nodes={nodes}
                    open={open === s.id}
                    onToggle={() => setOpen(o => (o === s.id ? null : s.id))}
                    onEdit={() => setDraft({id: s.id, name: s.name, telegram: s.telegram, site: s.site, message: s.message, nodeIds: s.nodeIds})}
                    act={act}
                  />
                ))}
              </ul>
            </Panel>
          )}
          {page.total > PAGE_SIZE && (
            <div className="flex items-center justify-between gap-3 text-[13px] text-dim">
              <span>
                {offset + 1}–{Math.min(offset + PAGE_SIZE, page.total)} из {page.total}
              </span>
              <div className="flex gap-2">
                <Button disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))}>
                  Назад
                </Button>
                <Button disabled={offset + PAGE_SIZE >= page.total} onClick={() => setOffset(o => o + PAGE_SIZE)}>
                  Дальше
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function SubscriptionRow({
  sub: s,
  nodes,
  open,
  onToggle,
  onEdit,
  act,
}: {
  sub: SubscriptionView;
  nodes: NodeView[];
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  act: (fn: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'delete' | 'rotate' | null>(null);
  const included = s.nodeIds.map(id => nodes.find(n => n.id === id)).filter((n): n is NodeView => !!n);
  const rw = s.remnawave;

  return (
    <li className="border-t border-wire/70 first:border-t-0">
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full grid grid-cols-[1fr_auto] items-center gap-3 px-5 py-3 text-left hover:bg-wire/20">
        <span className="min-w-0 grid gap-0.5">
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="text-ink truncate">{subTitle(s)}</span>
            {s.source === 'remnawave' && <span className="text-[11px] text-cyan">Remnawave</span>}
            {!s.active && <span className="text-[11px] text-bad">{STATUS_RU[rw?.status ?? ''] ?? rw?.status ?? 'неактивна'}</span>}
          </span>
          <span className="text-[12px] text-dim">
            {rw?.telegramId && `tg ${rw.telegramId} · `}
            {rw?.expireAt ? `до ${new Date(rw.expireAt).toLocaleDateString('ru-RU')} · ` : ''}
            {included.length} {plural(included.length, 'нода', 'ноды', 'нод')} · читали {ago(s.readAt)}
            {s.reads > 0 && ` (${s.reads})`}
          </span>
        </span>
        <CaretDownIcon size={16} className={`text-dim transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="grid gap-5 px-5 pb-5 lg:grid-cols-[1fr_auto]">
          <div className="grid gap-4 min-w-0">
            {s.message && <p className="text-dim whitespace-pre-line leading-relaxed max-w-[70ch]">{s.message}</p>}
            <CopyLine value={s.url} label="Копировать адрес подписки" />
            {included.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {included.map(n => (
                  <li key={n.id} className="chamfer-sm bg-wire/50 px-3 py-1 text-[12px] text-ink">
                    {n.name}
                    <span className="text-dim"> · {n.transports.map(t => TRANSPORTS[t.type]?.shortLabel ?? t.type).concat('Direct').join(', ')}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-warn">В подписке нет нод: клиент не сможет её добавить.</p>
            )}
            <History id={s.id} />
          </div>
          <div className="flex lg:flex-col gap-2 lg:items-end">
            <IconButton label="Что получит клиент" onClick={() => act(async () => setPreview((await get<{text: string}>(`/api/subscriptions/${s.id}/text`)).text))}>
              <EyeIcon size={16} />
            </IconButton>
            {s.source === 'manual' && (
              <>
                <IconButton label="Изменить" onClick={onEdit}>
                  <PencilSimpleIcon size={16} />
                </IconButton>
                <IconButton label="Сменить адрес" onClick={() => setConfirm('rotate')}>
                  <ArrowsClockwiseIcon size={16} />
                </IconButton>
                <IconButton label="Удалить" className="hover:!text-bad" onClick={() => setConfirm('delete')}>
                  <TrashIcon size={16} />
                </IconButton>
              </>
            )}
          </div>
        </div>
      )}

      {preview !== null && (
        <Confirm title={`Текст подписки «${subTitle(s)}»`} confirm="Закрыть" tone="ghost" onConfirm={() => setPreview(null)} onCancel={() => setPreview(null)}>
          <pre className="chamfer-sm bg-void p-3 font-mono text-[12px] text-cyan whitespace-pre-wrap break-all max-h-[50dvh] overflow-auto">{preview}</pre>
          <p className="mt-3 text-[12px]">Внутри ключи шифрования: адрес подписки передавайте только своим.</p>
        </Confirm>
      )}
      {confirm === 'delete' && (
        <Confirm
          title="Удалить подписку?"
          confirm="Удалить"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            void act(() => del(`/api/subscriptions/${s.id}`), 'Подписка удалена');
          }}
        >
          Адрес «{s.name}» перестанет отвечать. У клиентов, которые уже добавили подписку, профили останутся, но обновляться перестанут. Ноды не удаляются.
        </Confirm>
      )}
      {confirm === 'rotate' && (
        <Confirm
          title="Сменить адрес подписки?"
          confirm="Сменить"
          tone="acid"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            void act(() => post(`/api/subscriptions/${s.id}/rotate`), 'Адрес заменён');
          }}
        >
          Старый адрес сразу перестанет работать у всех, у кого он есть. Это нужно, если адрес попал не в те руки. Новый адрес придётся раздать заново.
        </Confirm>
      )}
    </li>
  );
}

/** Reads by day (90 days) and the last reads one by one (30 days). */
function History({id}: {id: string}) {
  const [h, setH] = useState<SubscriptionHistory | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    get<SubscriptionHistory>(`/api/subscriptions/${id}/history`).then(setH, e => setError(e.message));
  }, [id]);
  if (error) return <p className="text-bad text-[13px]">{error}</p>;
  if (!h) return <p className="text-dim text-[13px]">Загружаю историю…</p>;
  if (!h.days.length) return <p className="text-dim text-[13px]">Клиенты эту подписку ещё не читали.</p>;

  const days = lastDays(30).map(d => h.days.find(x => x.day === d) ?? {day: d, reads: 0, ips: 0});
  const max = Math.max(1, ...days.map(d => d.reads));
  const ips = new Set(h.reads.map(r => r.ip)).size;

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <div className="flex flex-wrap justify-between gap-2 text-[12px] text-dim">
          <span className="font-medium">Чтения за 30 дней, UTC</span>
          <span>
            <span className="text-acid">■</span> чтения · <span className="text-cyan">■</span> разных IP
          </span>
        </div>
        <div className="flex items-end gap-[3px] h-24" role="img" aria-label="Чтения по дням за 30 дней">
          {days.map(d => (
            <div key={d.day} className="flex-1 h-full flex items-end gap-px" title={`${d.day}: ${d.reads} чтений, ${d.ips} IP`}>
              <div className="flex-1 bg-acid/70" style={{height: `${(d.reads / max) * 100}%`, minHeight: d.reads ? 2 : 0}} />
              <div className="flex-1 bg-cyan/70" style={{height: `${(d.ips / max) * 100}%`, minHeight: d.ips ? 2 : 0}} />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[11px] text-dim">
          <span>{days[0].day.slice(5)}</span>
          <span>{days[days.length - 1].day.slice(5)}</span>
        </div>
      </div>
      {h.reads.length > 0 && (
        <details className="text-[12px]">
          <summary className="cursor-pointer text-dim hover:text-ink">
            Последние чтения: {h.reads.length}, разных IP: {ips}
          </summary>
          <div className="mt-2 max-h-64 overflow-auto">
            <table className="w-full text-left">
              <thead className="text-dim">
                <tr>
                  <th className="font-normal py-1 pr-3">Когда</th>
                  <th className="font-normal py-1 pr-3">IP</th>
                  <th className="font-normal py-1">Клиент</th>
                </tr>
              </thead>
              <tbody>
                {h.reads.map((r, i) => (
                  <tr key={i} className="border-t border-wire/50">
                    <td className="py-1 pr-3 whitespace-nowrap">{new Date(r.at).toLocaleString('ru-RU')}</td>
                    <td className="py-1 pr-3 whitespace-nowrap text-cyan">{r.ip}</td>
                    <td className="py-1 text-dim break-all">{r.ua || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function lastDays(n: number): string[] {
  const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  return Array.from({length: n}, (_, i) => new Date(today - (n - 1 - i) * 86400_000).toISOString().slice(0, 10));
}

/** The Remnawave sync: its state, a sync now, and the template every synced subscription gives. */
function SyncPanel({nodes, publicUrl, onSynced, onError}: {nodes: NodeView[]; publicUrl: string; onSynced: () => Promise<void>; onError: (m: string) => void}) {
  const [sync, setSync] = useState<RemnawaveSyncView | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    get<RemnawaveSyncView>('/api/remnawave/sync').then(setSync, e => onError(e.message));
  }, [onError]);

  if (!sync) return null;
  const last = sync.last;

  const save = async (d: Draft & {enabled: boolean}) => {
    try {
      setSync(await put<RemnawaveSyncView>('/api/remnawave/sync', d));
      setEditing(false);
      toast(d.enabled ? 'Шаблон сохранён, синхронизация запущена' : 'Шаблон сохранён');
      await onSynced();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <Panel className="mb-6">
      <div className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="font-display text-lg text-ink">Синхронизация с Remnawave</h2>
            {!sync.enabled ? (
              <StatusMark status="idle">выключена: подписка на каждого пользователя Remnawave не создаётся</StatusMark>
            ) : !last ? (
              <StatusMark status="live">первая синхронизация…</StatusMark>
            ) : last.ok ? (
              <StatusMark status="ok">
                {ago(last.at)}: пользователей {last.users}, создано {last.created}, удалено {last.removed}, изменено {last.updated}
              </StatusMark>
            ) : (
              <StatusMark status="fail">
                {ago(last.at)}: {last.error}
              </StatusMark>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setEditing(e => !e)}>Шаблон</Button>
            {sync.enabled && (
              <Button
                tone="acid"
                busy={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    setSync(await post<RemnawaveSyncView>('/api/remnawave/sync'));
                    await onSynced();
                  } catch (e) {
                    onError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <ArrowsClockwiseIcon size={16} /> Синхронизировать
              </Button>
            )}
          </div>
        </div>
        <p className="text-[12px] text-dim leading-relaxed max-w-[80ch]">
          Раз в 5 минут. Адрес подписки пользователя: <span className="text-cyan [overflow-wrap:anywhere]">{publicUrl}/sub/&lt;shortUuid&gt;</span>, тот же shortUuid, что в его
          ссылке Remnawave: его можно поставить кнопкой на страницу подписки Remnawave. Пользователь не в статусе ACTIVE получает отказ; удалённый в Remnawave
          теряет подписку.
        </p>
        {editing && (
          <Editor
            title="Шаблон подписок Remnawave"
            draft={{name: sync.name, telegram: sync.telegram, site: sync.site, message: sync.message, nodeIds: sync.nodeIds}}
            nodes={nodes}
            enabled={sync.enabled}
            locked={sync.fromEnv}
            onCancel={() => setEditing(false)}
            onSave={save}
          />
        )}
      </div>
    </Panel>
  );
}

function Editor({
  title,
  draft,
  nodes,
  enabled,
  locked = {},
  onSave,
  onCancel,
}: {
  title: string;
  draft: Draft;
  nodes: NodeView[];
  /** The sync template's switch; undefined for a subscription. */
  enabled?: boolean;
  /** Template fields .env sets, by variable. */
  locked?: RemnawaveSyncView['fromEnv'];
  onSave: (d: Draft & {enabled: boolean}) => Promise<void>;
  onCancel: () => void;
}) {
  const [d, setD] = useState({...draft, enabled: enabled ?? false});
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof d>) => setD(prev => ({...prev, ...patch}));
  const toggleNode = (id: string, on: boolean) => set({nodeIds: on ? [...d.nodeIds, id] : d.nodeIds.filter(x => x !== id)});
  const template = enabled !== undefined;

  return (
    <form
      className="grid gap-6"
      onSubmit={async e => {
        e.preventDefault();
        setBusy(true);
        await onSave(d);
        setBusy(false);
      }}
    >
      <h2 className="font-display text-xl text-ink">{title}</h2>
      {template && (
        <Toggle
          checked={d.enabled}
          onChange={on => set({enabled: on})}
          label="Синхронизировать пользователей"
          hint={locked.enabled ? <EnvNote name={locked.enabled} /> : 'Каждый пользователь Remnawave получит подписку с этими нодами и сообщением.'}
          disabled={!!locked.enabled}
        />
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Название" hint={locked.name ? <EnvNote name={locked.name} /> : 'Так подписка называется в списке у клиента.'}>
          {id => <Input id={id} value={d.name} maxLength={80} onChange={e => set({name: e.target.value})} required={!template} autoFocus disabled={!!locked.name} />}
        </Field>
        <Field label="Telegram" hint={locked.telegram ? <EnvNote name={locked.telegram} /> : '@канал или ссылка t.me: кнопка слева от сообщения.'}>
          {id => <Input id={id} value={d.telegram} onChange={e => set({telegram: e.target.value})} placeholder="@my_nodes" disabled={!!locked.telegram} />}
        </Field>
        <Field label="Сайт" hint={locked.site ? <EnvNote name={locked.site} /> : 'Только https: кнопка справа от сообщения.'}>
          {id => <Input id={id} value={d.site} onChange={e => set({site: e.target.value})} placeholder="nodes.example.com" disabled={!!locked.site} />}
        </Field>
        <div className="md:col-span-2">
          <Field label="Сообщение" hint={locked.message ? <EnvNote name={locked.message} /> : 'Показывается под заголовком подписки. До 600 символов.'}>
            {id => <TextArea id={id} rows={3} maxLength={600} value={d.message} onChange={e => set({message: e.target.value})} disabled={!!locked.message} />}
          </Field>
        </div>
      </div>
      <fieldset className="grid gap-3">
        <legend className="text-[13px] font-medium text-dim mb-3">Ноды в подписке</legend>
        {locked.nodeIds && (
          <p className="text-[12px] -mt-1">
            <EnvNote name={locked.nodeIds} />
          </p>
        )}
        {!nodes.length ? (
          <p className="text-dim">
            Нод пока нет.{' '}
            <a href="#/wizard" className="text-acid underline underline-offset-4">
              Поставьте свою
            </a>{' '}
            или добавьте по ссылке в разделе «Ноды».
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {nodes.map(n => (
              <Toggle
                key={n.id}
                checked={d.nodeIds.includes(n.id)}
                onChange={on => toggleNode(n.id, on)}
                label={n.name}
                hint={n.host || 'без адреса'}
                disabled={!!locked.nodeIds}
              />
            ))}
          </div>
        )}
      </fieldset>
      <div className="flex gap-2 justify-end">
        <Button type="button" onClick={onCancel}>
          Отмена
        </Button>
        <Button tone="acid" type="submit" busy={busy} disabled={!template && !d.name.trim()}>
          Сохранить
        </Button>
      </div>
    </form>
  );
}
