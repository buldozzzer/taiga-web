import {ArrowSquareOutIcon, CpuIcon, FilePlusIcon, LinkBreakIcon, PencilSimpleIcon, ShieldCheckIcon, TrashIcon} from '@phosphor-icons/react';
import {useCallback, useEffect, useState} from 'react';
import type {DiskDoc, PanelStatus} from '../../../shared/panel';
import {ago, del, get, post, put} from '../api';
import {go} from '../App';
import {Banner, Button, Confirm, CopyLine, Empty, Field, IconButton, Input, PageHead, Panel, Skeleton, StatusMark, useToast} from '../components/ui';

/** Creates a document on the owner's Disk; shared by this page and the wizard. */
export async function createDoc(name: string): Promise<DiskDoc> {
  return post<DiskDoc>('/api/docs', {name});
}

export function DocStatus({doc}: {doc: DiskDoc}) {
  if (!doc.editUrl) return <StatusMark status="warn">Диск не отдал ссылку редактирования: вставьте её вручную</StatusMark>;
  if (!doc.check) return <StatusMark status="idle">не проверялся</StatusMark>;
  const status = doc.check.status === 'ok' ? 'ok' : doc.check.status === 'captcha' ? 'warn' : 'fail';
  return <StatusMark status={status}>{doc.check.status === 'captcha' ? 'Яндекс просит капчу у сервера панели: нода проверит сама' : doc.check.text}</StatusMark>;
}

/** Which node goes through the document: each document carries one node. */
export function DocBinding({doc}: {doc: DiskDoc}) {
  if (doc.nodeId)
    return (
      <button type="button" onClick={() => go('nodes')} className="chamfer-sm inline-flex items-center gap-2 px-3 py-1.5 text-[12px] bg-acid/15 text-acid hover:bg-acid/25" title="Открыть ноды">
        <CpuIcon size={14} weight="bold" /> Канал ноды «{doc.nodeName}»
      </button>
    );
  return (
    <span className="chamfer-sm inline-flex items-center gap-2 px-3 py-1.5 text-[12px] bg-wire/50 text-dim">
      <LinkBreakIcon size={14} /> Свободен{doc.editUrl ? ': его можно выбрать в мастере «Своя нода»' : ''}
    </span>
  );
}

export function Docs({status}: {status: PanelStatus | null}) {
  const [docs, setDocs] = useState<DiskDoc[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [manual, setManual] = useState<DiskDoc | null>(null);
  const [removing, setRemoving] = useState<DiskDoc | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setDocs(await get<DiskDoc[]>('/api/docs'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    setError('');
    try {
      await fn();
      if (done) toast(done);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const connected = status?.yandex.connected;

  return (
    <>
      <PageHead
        title="Документы"
        sub="Пустые документы на вашем Яндекс Диске, открытые на редактирование всем, у кого есть ссылка. Через такой документ нода и клиент обмениваются трафиком (транспорт Volga). Один документ — одна нода."
      />
      {error && (
        <div className="mb-6">
          <Banner tone="error" onClose={() => setError('')}>
            {error}
          </Banner>
        </div>
      )}
      {status && !connected ? (
        <Empty
          title="Яндекс Диск не подключён"
          action={
            <Button tone="acid" onClick={() => go('settings')}>
              Подключить
            </Button>
          }
        >
          Документы создаются на Диске владельца панели. Вставьте OAuth-токен с доступом к Диску в настройках.
        </Empty>
      ) : (
        <>
          <Panel className="mb-6">
            <form
              className="grid gap-4 md:grid-cols-[1fr_auto] md:items-start"
              onSubmit={e => {
                e.preventDefault();
                void run('create', async () => {
                  const doc = await createDoc(name.trim() || 'taiga');
                  setName('');
                  if (!doc.editUrl) setManual(doc);
                }, 'Документ создан');
              }}
            >
              <Field label="Новый документ" hint="У каждой ноды свой документ: на одном документе две ноды мешают друг другу, поэтому занятый документ панель другой ноде не даст.">
                {id => <Input id={id} value={name} maxLength={60} onChange={e => setName(e.target.value)} placeholder="например, moscow-1" />}
              </Field>
              <Button tone="acid" type="submit" className="md:mt-[26px]" busy={busy === 'create'}>
                <FilePlusIcon size={16} weight="bold" /> Создать
              </Button>
            </form>
          </Panel>
          {!docs ? (
            <Skeleton />
          ) : !docs.length ? (
            <p className="text-dim">Документов пока нет. Создайте первый выше или прямо в мастере ноды.</p>
          ) : (
            <div className="grid gap-4">
              {docs.map((d, i) => (
                  <Panel key={d.id} className="rise" style={{'--i': i} as React.CSSProperties}>
                    <div className="grid gap-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="grid gap-1 min-w-0">
                          <h2 className="font-display text-lg text-ink truncate">{d.name}</h2>
                          <p className="text-[12px] text-dim truncate">
                            {d.path} · {ago(d.createdAt)}
                          </p>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          {d.publicUrl && (
                            <a href={d.publicUrl} target="_blank" rel="noreferrer noopener" className="chamfer-sm grid place-items-center size-9 bg-wire/50 text-dim hover:text-ink" title="Открыть на Диске" aria-label="Открыть на Диске">
                              <ArrowSquareOutIcon size={16} />
                            </a>
                          )}
                          <IconButton label="Вставить ссылку вручную" onClick={() => setManual(d)}>
                            <PencilSimpleIcon size={16} />
                          </IconButton>
                          <IconButton label="Удалить с Диска" className="hover:!text-bad" onClick={() => setRemoving(d)}>
                            <TrashIcon size={16} />
                          </IconButton>
                        </div>
                      </div>
                      <div>
                        <DocBinding doc={d} />
                      </div>
                      {d.editUrl ? <CopyLine value={d.editUrl} label="Копировать ссылку редактирования" /> : d.publicUrl && <CopyLine value={d.publicUrl} label="Копировать публичную ссылку" />}
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <DocStatus doc={d} />
                        <Button onClick={() => run(d.id, () => post(`/api/docs/${d.id}/check`))} busy={busy === d.id} disabled={!!busy && busy !== d.id}>
                          <ShieldCheckIcon size={16} /> Проверить
                        </Button>
                      </div>
                    </div>
                  </Panel>
              ))}
            </div>
          )}
        </>
      )}

      {manual && <ManualLink doc={manual} onClose={() => setManual(null)} onDone={() => void load()} />}
      {removing && (
        <Confirm
          title="Удалить документ?"
          confirm="Удалить"
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const d = removing;
            setRemoving(null);
            void run(d.id, () => del(`/api/docs/${d.id}`), 'Документ удалён');
          }}
        >
          <p>Файл удалится с Диска навсегда, и ссылка перестанет работать.</p>
          {removing.nodeId && (
            <p className="mt-3 text-warn">Это канал ноды «{removing.nodeName}»: она потеряет Volga и останется только на Direct и других транспортах.</p>
          )}
        </Confirm>
      )}
    </>
  );
}

function ManualLink({doc, onClose, onDone}: {doc: DiskDoc; onClose: () => void; onDone: () => void}) {
  const [url, setUrl] = useState(doc.editUrl);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-void/80 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-label="Ссылка редактирования" onClick={onClose}>
      <div className="w-full max-w-lg rise" onClick={e => e.stopPropagation()}>
        <Panel>
          <form
            className="grid gap-5"
            onSubmit={async e => {
              e.preventDefault();
              setBusy(true);
              try {
                await put(`/api/docs/${doc.id}`, {editUrl: url});
                onDone();
                onClose();
              } catch (err) {
                setError((err as Error).message);
                setBusy(false);
              }
            }}
          >
            <h2 className="font-display text-xl text-ink">Ссылка редактирования</h2>
            <p className="text-dim leading-relaxed">
              Откройте документ на Диске, нажмите «Поделиться», выберите доступ «Редактирование» для всех, у кого есть ссылка, и вставьте её сюда.
            </p>
            {doc.publicUrl && (
              <a href={doc.publicUrl} target="_blank" rel="noreferrer noopener" className="text-acid underline underline-offset-4 justify-self-start">
                Открыть «{doc.name}» на Диске
              </a>
            )}
            <Field label="Ссылка" error={error}>
              {id => <Input id={id} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://disk.yandex.ru/edit/d/…" autoFocus />}
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={onClose}>
                Отмена
              </Button>
              <Button tone="acid" type="submit" busy={busy} disabled={!url.trim()}>
                Сохранить и проверить
              </Button>
            </div>
          </form>
        </Panel>
      </div>
    </div>
  );
}
