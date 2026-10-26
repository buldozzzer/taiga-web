import {ArrowsClockwiseIcon} from '@phosphor-icons/react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {type PanelSettings, type PanelStatus, type RemnawaveNode, countryFlag} from '../../../shared/panel';
import {del, get, put} from '../api';
import {Button, EnvNote, Field, Input, Panel, StatusMark, TextArea, useToast} from '../components/ui';

/** The Remnawave panel's nodes, read on the server with the saved token. */
export function useRemnawaveNodes(connected: boolean) {
  const [nodes, setNodes] = useState<RemnawaveNode[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!connected) return setNodes(null);
    setLoading(true);
    setError('');
    try {
      setNodes(await get<RemnawaveNode[]>('/api/remnawave/nodes'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [connected]);
  useEffect(() => void load(), [load]);
  return {nodes, error, loading, reload: load};
}

/** A node's name with its country's flag in front, unless the name already starts with one. */
export function flagged(n: Pick<RemnawaveNode, 'name' | 'countryCode'>): string {
  const flag = countryFlag(n.countryCode);
  return flag && !n.name.startsWith(flag) ? `${flag} ${n.name}` : n.name;
}

type Run = (key: string, fn: () => Promise<void>) => Promise<void>;

export function AdvancedSettings({settings, status, busy, run}: {settings: PanelSettings; status: PanelStatus | null; busy: string | null; run: Run}) {
  return (
    <Panel>
      <div className="grid gap-8">
        <div className="grid gap-1">
          <h2 className="font-display text-xl text-ink">Расширенные</h2>
          <p className="text-dim text-[13px]">Токен и ключ хранятся только на сервере панели (data/db.json, права 0600) и в браузер не возвращаются.</p>
        </div>
        <div className="grid gap-8 xl:grid-cols-2">
          <RemnawaveSettings settings={settings} connected={!!status?.remnawave.connected} busy={busy} run={run} />
          <SshKeySettings settings={settings} busy={busy} run={run} />
        </div>
      </div>
    </Panel>
  );
}

function RemnawaveSettings({settings, connected, busy, run}: {settings: PanelSettings; connected: boolean; busy: string | null; run: Run}) {
  const [url, setUrl] = useState(settings.remnawaveUrl);
  const [token, setToken] = useState('');
  const {nodes, error, loading, reload} = useRemnawaveNodes(connected);
  const toast = useToast();
  const env = settings.fromEnv;
  const bothFromEnv = !!(env.remnawaveUrl && env.remnawaveToken);
  // A saved token goes on with the same panel: only a new address needs a new one.
  const ready = url.trim() && (env.remnawaveToken || token.trim() || (connected && url.trim() === settings.remnawaveUrl));

  return (
    <section className="grid gap-4 content-start">
      <div className="grid gap-2">
        <h3 className="font-display text-lg text-ink">Remnawave</h3>
        {connected ? <StatusMark status="ok">подключён: {settings.remnawaveUrl}</StatusMark> : <StatusMark status="idle">не подключён</StatusMark>}
        <p className="text-dim text-[13px] leading-relaxed max-w-[65ch]">
          Список нод вашей панели Remnawave: мастер «Своя нода» предложит их адреса. Токен создаётся в Remnawave: «Настройки → API-токены».
        </p>
      </div>
      {bothFromEnv ? (
        <p className="text-[13px]">
          <EnvNote name={`${env.remnawaveUrl}, ${env.remnawaveToken}`} />
        </p>
      ) : (
      <form
        className="grid gap-4"
        onSubmit={e => {
          e.preventDefault();
          void run('remnawave', async () => {
            const r = await put<{nodes: number}>('/api/settings/remnawave', {url, token});
            setToken('');
            toast(`Remnawave подключён: нод ${r.nodes}`);
            await reload();
          });
        }}
      >
        <Field label="Адрес панели" hint={env.remnawaveUrl && <EnvNote name={env.remnawaveUrl} />}>
          {id => <Input id={id} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://panel.example.com" autoComplete="off" disabled={!!env.remnawaveUrl} />}
        </Field>
        <Field label="API-токен" hint={env.remnawaveToken ? <EnvNote name={env.remnawaveToken} /> : connected ? 'Оставьте пустым, чтобы сохранить прежний.' : undefined}>
          {id => (
            <Input
              id={id}
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              autoComplete="off"
              placeholder={connected ? '••••••••' : 'eyJhbGci…'}
              disabled={!!env.remnawaveToken}
            />
          )}
        </Field>
        <div className="flex flex-wrap gap-3">
          <Button tone="acid" type="submit" busy={busy === 'remnawave'} disabled={!ready}>
            {connected ? 'Сохранить' : 'Подключить'}
          </Button>
          {connected && !env.remnawaveUrl && !env.remnawaveToken && (
            <Button
              tone="danger"
              busy={busy === 'remnawave-drop'}
              onClick={() =>
                run('remnawave-drop', async () => {
                  await del('/api/settings/remnawave');
                  setUrl('');
                  toast('Remnawave отключён, токен удалён');
                })
              }
            >
              Отключить
            </Button>
          )}
        </div>
      </form>
      )}
      {connected && (
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-dim text-[13px] font-medium">Ноды {nodes ? `· ${nodes.length}` : ''}</span>
            <button type="button" onClick={() => void reload()} className="text-dim hover:text-ink inline-flex items-center gap-1 text-[12px]" disabled={loading}>
              <ArrowsClockwiseIcon size={14} className={loading ? 'animate-spin' : ''} /> Обновить
            </button>
          </div>
          {error && <p className="text-bad text-[13px]">{error}</p>}
          {nodes && nodes.length === 0 && <p className="text-dim text-[13px]">В Remnawave пока нет нод.</p>}
          {nodes && nodes.length > 0 && (
            <ul className="grid gap-1 text-[13px] max-h-80 overflow-y-auto pr-2 [scrollbar-width:thin]">
              {nodes.map(n => (
                <li key={n.uuid} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t border-wire/60 pt-1.5">
                  <span className={n.disabled ? 'text-dim' : 'text-ink'}>
                    {flagged(n)} <span className="text-dim">{n.address}</span>
                  </span>
                  <span className="text-[12px]">
                    {n.taigaNodeId ? <span className="text-ok">Taiga: {n.taigaNodeName}</span> : <span className="text-dim">без Taiga</span>}
                    {n.disabled ? <span className="text-dim"> · выключена</span> : !n.connected && <span className="text-warn"> · не на связи</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function SshKeySettings({settings, busy, run}: {settings: PanelSettings; busy: string | null; run: Run}) {
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [user, setUser] = useState(settings.sshUser);
  const keyFile = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const key = settings.sshKey;
  const env = settings.fromEnv;
  const keyFromEnv = !!env.sshPrivateKey;
  const ready = privateKey.trim() || (key && !env.sshUser && user.trim() !== settings.sshUser);

  return (
    <section className="grid gap-4 content-start">
      <div className="grid gap-2">
        <h3 className="font-display text-lg text-ink">SSH-ключ для нод</h3>
        {key ? (
          <StatusMark status="ok">
            {key.type}
            {key.encrypted && ', с паролем'}
          </StatusMark>
        ) : (
          <StatusMark status="idle">не сохранён</StatusMark>
        )}
        {key?.fingerprint && <code className="text-dim text-[12px] break-all">{key.fingerprint}</code>}
        {keyFromEnv && (
          <p className="text-[13px]">
            <EnvNote name={[env.sshPrivateKey, env.sshPassphrase].filter(Boolean).join(', ')} />
          </p>
        )}
        <p className="text-dim text-[13px] leading-relaxed max-w-[65ch]">
          Мастер «Своя нода» войдёт с ним на сервер без вставки ключа. Добавьте публичную половину в ~/.ssh/authorized_keys на нодах.
        </p>
      </div>
      <form
        className="grid gap-4"
        onSubmit={e => {
          e.preventDefault();
          void run('ssh', async () => {
            await put('/api/settings/ssh', {privateKey, passphrase, user});
            setPrivateKey('');
            setPassphrase('');
            toast(privateKey.trim() ? 'SSH-ключ сохранён' : 'Логин сохранён');
          });
        }}
      >
        {!keyFromEnv && (
          <>
        <Field
          label={key ? 'Новый приватный ключ' : 'Приватный ключ'}
          hint={
            <>
              OpenSSH или PEM.{' '}
              <button type="button" className="text-acid underline underline-offset-4" onClick={() => keyFile.current?.click()}>
                Выбрать файл
              </button>
            </>
          }
        >
          {id => <TextArea id={id} rows={4} value={privateKey} onChange={e => setPrivateKey(e.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" spellCheck={false} />}
        </Field>
        <input
          ref={keyFile}
          type="file"
          className="hidden"
          onChange={async e => {
            const file = e.target.files?.[0];
            if (file && file.size < 64 * 1024) setPrivateKey(await file.text());
            e.target.value = '';
          }}
        />
          </>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {!keyFromEnv && (
            <Field label="Пароль ключа" hint="Если ключ зашифрован.">
              {id => <Input id={id} type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)} autoComplete="off" />}
            </Field>
          )}
          <Field label="Логин на нодах" hint={env.sshUser && <EnvNote name={env.sshUser} />}>
            {id => <Input id={id} value={user} onChange={e => setUser(e.target.value)} autoComplete="off" disabled={!!env.sshUser} />}
          </Field>
        </div>
        {!(keyFromEnv && env.sshUser) && (
        <div className="flex flex-wrap gap-3">
          <Button tone="acid" type="submit" busy={busy === 'ssh'} disabled={!ready}>
            {key && !privateKey.trim() ? 'Сохранить логин' : key ? 'Заменить ключ' : 'Сохранить ключ'}
          </Button>
          {key && !keyFromEnv && (
            <Button
              tone="danger"
              busy={busy === 'ssh-drop'}
              onClick={() =>
                run('ssh-drop', async () => {
                  await del('/api/settings/ssh');
                  toast('SSH-ключ удалён из панели');
                })
              }
            >
              Удалить ключ
            </Button>
          )}
        </div>
        )}
      </form>
    </section>
  );
}
