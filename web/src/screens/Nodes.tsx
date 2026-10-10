import {CloudArrowUpIcon, FileTextIcon, LinkIcon, PencilSimpleIcon, TrashIcon} from '@phosphor-icons/react';
import {useCallback, useEffect, useState} from 'react';
import {TRANSPORTS, plural} from '../../../shared/model';
import type {DiskDoc, NodeView} from '../../../shared/panel';
import {ago, copy, del, get, patch, post} from '../api';
import {go} from '../App';
import {Banner, Button, Confirm, CopyLine, Empty, Field, IconButton, Input, PageHead, Panel, Skeleton, TextArea, useToast} from '../components/ui';

export function Nodes() {
  const [nodes, setNodes] = useState<NodeView[] | null>(null);
  const [docs, setDocs] = useState<DiskDoc[]>([]);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [renaming, setRenaming] = useState<NodeView | null>(null);
  const [removing, setRemoving] = useState<NodeView | null>(null);
  const toast = useToast();

  const load = useCallback(() => {
    get<DiskDoc[]>('/api/docs').then(setDocs, () => {});
    return get<NodeView[]>('/api/nodes').then(setNodes, e => setError(e.message));
  }, []);
  const docOf = (n: NodeView) => docs.find(d => d.nodeId === n.id);
  useEffect(() => void load(), [load]);

  const copyLink = async (n: NodeView) => {
    // copy() must get the request before any await, or Safari refuses the clipboard
    const link = get<{link: string}>(`/api/nodes/${n.id}/link`).then(r => r.link);
    try {
      toast((await copy(link)) ? 'Ссылка taiga:// скопирована' : 'Браузер не дал доступ к буферу');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <PageHead
        title="Ноды"
        sub="Выходы, которые можно раздавать в подписках."
        actions={
          <>
            <Button onClick={() => setImporting(v => !v)}>
              <LinkIcon size={16} /> Добавить по ссылке
            </Button>
            <Button tone="acid" onClick={() => go('wizard')}>
              <CloudArrowUpIcon size={16} weight="bold" /> Поставить ноду
            </Button>
          </>
        }
      />
      {error && (
        <div className="mb-6">
          <Banner tone="error" onClose={() => setError('')}>
            {error}
          </Banner>
        </div>
      )}
      {importing && (
        <ImportLinks
          onCancel={() => setImporting(false)}
          onDone={(added, failed) => {
            setImporting(false);
            if (failed.length) setError(`Не прочитались: ${failed.join('; ')}`);
            if (added) toast(`Добавлено ${added} ${plural(added, 'нода', 'ноды', 'нод')}`);
            void load();
          }}
        />
      )}
      {!nodes ? (
        <Skeleton />
      ) : !nodes.length ? (
        <Empty
          title="Нод пока нет"
          action={
            <Button tone="acid" onClick={() => go('wizard')}>
              Поставить ноду на сервер
            </Button>
          }
        >
          Мастер подключится к вашему VDS по SSH, поставит выход с документом Яндекса и Direct в резерве и проверит, что трафик выходит с адреса сервера.
        </Empty>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {nodes.map((n, i) => (
            <Panel key={n.id} className="rise" style={{'--i': i} as React.CSSProperties}>
              <div className="grid gap-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="grid gap-1 min-w-0">
                    <h2 className="font-display text-xl text-ink break-words">{n.name}</h2>
                    <p className="text-[12px] text-dim break-words">
                      {n.host ? `${n.host}:${n.port}` : 'без Direct'}
                      {n.channel && ` · канал ${n.channel}`} · {n.source === 'wizard' ? 'мастер' : 'по ссылке'}, {ago(n.createdAt)}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <IconButton label="Копировать ссылку taiga://" onClick={() => copyLink(n)}>
                      <LinkIcon size={16} />
                    </IconButton>
                    <IconButton label="Переименовать" onClick={() => setRenaming(n)}>
                      <PencilSimpleIcon size={16} />
                    </IconButton>
                    <IconButton label="Убрать из панели" className="hover:!text-bad" onClick={() => setRemoving(n)}>
                      <TrashIcon size={16} />
                    </IconButton>
                  </div>
                </div>
                <ul className="flex flex-wrap gap-2">
                  {n.transports.map((t, k) => (
                    <li key={k} className={`chamfer-sm px-3 py-1 text-[12px] ${k === 0 ? 'bg-acid/15 text-acid' : 'bg-wire/50 text-ink'}`}>
                      {TRANSPORTS[t.type]?.shortLabel ?? t.type}
                    </li>
                  ))}
                  {n.host && <li className="chamfer-sm px-3 py-1 text-[12px] bg-wire/50 text-ink">Direct</li>}
                </ul>
                <NodeDocument node={n} doc={docOf(n)} />
              </div>
            </Panel>
          ))}
        </div>
      )}

      {renaming && <Rename node={renaming} onClose={() => setRenaming(null)} onDone={() => void load()} />}
      {removing && (
        <Confirm
          title="Убрать ноду из панели?"
          confirm="Убрать"
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            const n = removing;
            setRemoving(null);
            try {
              await del(`/api/nodes/${n.id}`);
              toast('Нода убрана');
              void load();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <p>«{removing.name}» пропадёт из всех подписок, и при следующем обновлении клиенты её уберут.</p>
          {docOf(removing) && <p className="mt-3">Документ «{docOf(removing)!.name}» станет свободным, но сервер ещё может через него работать: снимите канал, прежде чем отдавать документ другой ноде.</p>}
          {removing.uninstall && (
            <div className="mt-4 grid gap-2">
              <p>Сам сервер это не трогает. Чтобы снять канал с VDS, выполните там:</p>
              <CopyLine value={removing.uninstall} />
            </div>
          )}
        </Confirm>
      )}
    </>
  );
}

/** The Yandex document the node's Volga goes through: one per node. */
function NodeDocument({node, doc}: {node: NodeView; doc: DiskDoc | undefined}) {
  if (!node.transports.some(t => t.type === 'vyandex')) return null;
  return (
    <p className="flex items-center gap-2 text-[12px] min-w-0">
      <FileTextIcon size={14} className="shrink-0 text-cyan" />
      {doc ? (
        <>
          <span className="text-dim shrink-0">Документ</span>
          <button type="button" onClick={() => go('docs')} className="text-cyan underline underline-offset-4 truncate" title="Открыть документы">
            «{doc.name}»
          </button>
        </>
      ) : (
        <span className="text-dim">Документ Яндекса не из панели</span>
      )}
    </p>
  );
}

function ImportLinks({onCancel, onDone}: {onCancel: () => void; onDone: (added: number, failed: string[]) => void}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Panel className="mb-6 rise">
      <form
        className="grid gap-5"
        onSubmit={async e => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            const r = await post<{added: NodeView[]; failed: string[]}>('/api/nodes/import', {text});
            onDone(r.added.length, r.failed);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Ссылки taiga://" hint="По одной на строку. Подходят и openflux:// от других клиентов." error={error}>
          {id => <TextArea id={id} rows={4} value={text} onChange={e => setText(e.target.value)} placeholder="taiga://v1/…" autoFocus />}
        </Field>
        <div className="flex gap-2 justify-end">
          <Button type="button" onClick={onCancel}>
            Отмена
          </Button>
          <Button tone="acid" type="submit" busy={busy} disabled={!text.trim()}>
            Добавить
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function Rename({node, onClose, onDone}: {node: NodeView; onClose: () => void; onDone: () => void}) {
  const [name, setName] = useState(node.name);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-void/80 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-label="Переименовать" onClick={onClose}>
      <div className="w-full max-w-md rise" onClick={e => e.stopPropagation()}>
        <Panel>
          <form
            className="grid gap-5"
            onSubmit={async e => {
              e.preventDefault();
              setBusy(true);
              try {
                await patch(`/api/nodes/${node.id}`, {name});
                onDone();
                onClose();
              } catch (err) {
                setError((err as Error).message);
                setBusy(false);
              }
            }}
          >
            <Field label="Название ноды" hint="Новое название попадёт и в ссылку: клиенты увидят его после обновления подписки." error={error}>
              {id => <Input id={id} value={name} maxLength={80} onChange={e => setName(e.target.value)} autoFocus />}
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={onClose}>
                Отмена
              </Button>
              <Button tone="acid" type="submit" busy={busy} disabled={!name.trim()}>
                Сохранить
              </Button>
            </div>
          </form>
        </Panel>
      </div>
    </div>
  );
}
