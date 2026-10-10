import {useEffect, useState} from 'react';
import type {PanelSettings, PanelStatus} from '../../../shared/panel';
import {del, get, put} from '../api';
import {Banner, Button, EnvNote, Field, Input, PageHead, Panel, StatusMark, useToast} from '../components/ui';
import {AdvancedSettings} from './Advanced';

export function Settings({status, onChange}: {status: PanelStatus | null; onChange: () => void}) {
  const [settings, setSettings] = useState<PanelSettings | null>(null);
  const [token, setToken] = useState('');
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const toast = useToast();

  const loadSettings = () => get<PanelSettings>('/api/settings').then(setSettings, e => setError(e.message));

  useEffect(() => {
    get<PanelSettings>('/api/settings').then(s => {
      setSettings(s);
      setFolder(s.docsFolder);
    }, e => setError(e.message));
  }, []);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError('');
    try {
      await fn();
      onChange();
      await loadSettings();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHead title="Настройки" />
      {error && (
        <div className="mb-6">
          <Banner tone="error" onClose={() => setError('')}>
            {error}
          </Banner>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Panel>
          <div className="grid gap-6">
            <div className="grid gap-2">
              <h2 className="font-display text-xl text-ink">Яндекс Диск</h2>
              {status?.yandex.connected ? <StatusMark status="ok">подключён: {status.yandex.user}</StatusMark> : <StatusMark status="idle">не подключён</StatusMark>}
            </div>
            <ol className="grid gap-2 text-dim leading-relaxed list-decimal pl-5 max-w-[65ch]">
              <li>
                Создайте приложение на{' '}
                <a href="https://oauth.yandex.ru/client/new" target="_blank" rel="noreferrer noopener" className="text-acid underline underline-offset-4">
                  oauth.yandex.ru
                </a>{' '}
                с доступами «Чтение всего Диска» и «Запись в любом месте на Диске».
              </li>
              <li>Откройте https://oauth.yandex.ru/authorize?response_type=token&amp;client_id=&lt;ClientID&gt; под владельцем Диска и скопируйте токен.</li>
              <li>
                Права «редактирование по ссылке» Диск даёт не на всех аккаунтах. Если ссылку редактирования получить не удастся, панель попросит вставить её вручную.
              </li>
            </ol>
            {settings?.fromEnv.yandexToken ? (
              <p className="text-[13px]">
                <EnvNote name={settings.fromEnv.yandexToken} />
              </p>
            ) : (
            <form
              className="grid gap-4 md:grid-cols-[1fr_auto] md:items-start"
              onSubmit={e => {
                e.preventDefault();
                void run('token', async () => {
                  const r = await put<{user: string}>('/api/settings/yandex', {token});
                  setToken('');
                  toast(`Подключён Диск: ${r.user}`);
                });
              }}
            >
              <Field label="OAuth-токен" hint="Хранится только на сервере панели и в браузер не возвращается.">
                {id => <Input id={id} type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="off" placeholder="y0_…" />}
              </Field>
              <Button tone="acid" type="submit" className="md:mt-[26px]" busy={busy === 'token'} disabled={!token.trim()}>
                {status?.yandex.connected ? 'Заменить' : 'Подключить'}
              </Button>
            </form>
            )}
            {status?.yandex.connected && !settings?.fromEnv.yandexToken && (
              <Button
                tone="danger"
                className="justify-self-start"
                busy={busy === 'drop'}
                onClick={() =>
                  run('drop', async () => {
                    await del('/api/settings/yandex');
                    toast('Токен удалён из панели');
                  })
                }
              >
                Отключить Диск
              </Button>
            )}
            {settings && (
              <form
                className="grid gap-4 md:grid-cols-[1fr_auto] md:items-start"
                onSubmit={e => {
                  e.preventDefault();
                  void run('folder', async () => {
                    await put('/api/settings', {docsFolder: folder});
                    toast('Папка сохранена');
                  });
                }}
              >
                <Field label="Папка для документов" hint={settings.fromEnv.docsFolder && <EnvNote name={settings.fromEnv.docsFolder} />}>
                  {id => <Input id={id} value={folder} onChange={e => setFolder(e.target.value)} disabled={!!settings.fromEnv.docsFolder} />}
                </Field>
                <Button type="submit" className="md:mt-[26px]" busy={busy === 'folder'} disabled={folder === settings.docsFolder || !!settings.fromEnv.docsFolder}>
                  Сохранить
                </Button>
              </form>
            )}
          </div>
        </Panel>
        <Panel>
          <div className="grid gap-5">
            <h2 className="font-display text-xl text-ink">Сервер панели</h2>
            {status && (
              <dl className="grid gap-4 text-[13px]">
                <div className="grid gap-1">
                  <dt className="text-dim">Ядро Taiga</dt>
                  <dd className={status.core.ok ? 'text-ink break-all' : 'text-bad break-all'}>
                    {status.core.ok ? status.core.version : 'не найдено'}
                    <span className="block text-dim">{status.core.path}</span>
                  </dd>
                </div>
                <div className="grid gap-1">
                  <dt className="text-dim">Адрес для подписок</dt>
                  <dd className="text-ink break-all">{status.publicUrl}</dd>
                </div>
              </dl>
            )}
            <p className="text-[12px] text-dim leading-relaxed">
              Путь к ядру, пароль и публичный адрес задаются в .env (TAIGA_CORE, ADMIN_PASSWORD, PUBLIC_URL). Там же можно задать любую настройку этой
              страницы: такая настройка важнее сохранённой здесь, список переменных в .env.example. Клиенты читают подписку по адресу панели: откройте его наружу через https.
            </p>
          </div>
        </Panel>
        {settings && (
          <div className="xl:col-span-2">
            <AdvancedSettings settings={settings} status={status} busy={busy} run={run} />
          </div>
        )}
      </div>
    </>
  );
}
