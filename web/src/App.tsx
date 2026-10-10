import {CloudIcon, CpuIcon, FileTextIcon, GearSixIcon, ShareNetworkIcon, SignOutIcon, TerminalWindowIcon} from '@phosphor-icons/react';
import {type ReactNode, useCallback, useEffect, useState} from 'react';
import type {PanelStatus} from '../../shared/panel';
import {get, post, setUnauthorizedHandler} from './api';
import {Login} from './screens/Login';
import {Docs} from './screens/Docs';
import {Journal} from './screens/Journal';
import {Nodes} from './screens/Nodes';
import {Settings} from './screens/Settings';
import {Subscriptions} from './screens/Subscriptions';
import {Wizard} from './screens/Wizard';

export type Route = 'nodes' | 'subs' | 'docs' | 'wizard' | 'log' | 'settings';

const NAV: {route: Route; label: string; icon: ReactNode}[] = [
  {route: 'subs', label: 'Подписки', icon: <ShareNetworkIcon size={18} />},
  {route: 'nodes', label: 'Ноды', icon: <CpuIcon size={18} />},
  {route: 'wizard', label: 'Своя нода', icon: <CloudIcon size={18} />},
  {route: 'docs', label: 'Документы', icon: <FileTextIcon size={18} />},
  {route: 'log', label: 'Журнал', icon: <TerminalWindowIcon size={18} />},
  {route: 'settings', label: 'Настройки', icon: <GearSixIcon size={18} />},
];

const readRoute = (): Route => {
  const r = location.hash.replace(/^#\/?/, '') as Route;
  return NAV.some(n => n.route === r) ? r : 'subs';
};

export const go = (route: Route) => {
  location.hash = `/${route}`;
};

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [route, setRoute] = useState<Route>(readRoute);
  const [status, setStatus] = useState<PanelStatus | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => setAuthed(false));
    get<{authed: boolean}>('/api/me').then(r => setAuthed(r.authed), () => setAuthed(false));
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const refreshStatus = useCallback(() => {
    get<PanelStatus>('/api/status').then(setStatus, () => {});
  }, []);
  useEffect(() => {
    if (authed) refreshStatus();
  }, [authed, refreshStatus]);

  if (authed === null) return null;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  return (
    <div className="min-h-[100dvh] md:grid md:grid-cols-[232px_1fr]">
      <aside className="md:sticky md:top-0 md:h-[100dvh] flex md:flex-col border-b md:border-b-0 md:border-r border-wire bg-steel/70 backdrop-blur">
        <div className="hidden md:block px-5 pt-6 pb-8">
          <p className="font-display text-2xl font-bold text-acid glow-acid tracking-tight">
            TAIGA<span className="text-cyan">//</span>
          </p>
          <p className="text-[12px] text-dim mt-1">панель оператора</p>
        </div>
        <nav className="flex md:flex-col flex-1 overflow-x-auto md:overflow-visible" aria-label="Разделы">
          {NAV.map(n => (
            <a
              key={n.route}
              href={`#/${n.route}`}
              aria-current={route === n.route ? 'page' : undefined}
              aria-label={n.label}
              title={n.label}
              className={`glitch flex flex-1 md:flex-none items-center justify-center md:justify-start gap-3 px-3 md:px-5 h-12 md:h-11 min-w-11 text-[13px] uppercase tracking-[0.08em] border-b-2 md:border-b-0 md:border-l-2 transition-colors ${
                route === n.route ? 'border-acid text-acid bg-acid/5' : 'border-transparent text-dim hover:text-ink hover:bg-wire/30'
              }`}
            >
              {n.icon}
              <span className="hidden md:inline">{n.label}</span>
            </a>
          ))}
        </nav>
        <div className="hidden md:grid gap-3 px-5 py-5 border-t border-wire text-[12px]">
          {status && (
            <>
              <p className={`truncate ${status.core.ok ? 'text-ok' : 'text-bad'}`} title={`${status.core.version}\n${status.core.path}`}>
                ядро: {status.core.ok ? status.core.version.split('+')[0] : 'не найдено'}
              </p>
              <p className={status.yandex.connected ? 'text-ok' : 'text-dim'}>диск {status.yandex.connected ? status.yandex.user : 'не подключён'}</p>
            </>
          )}
          <button
            onClick={() => post('/api/logout').finally(() => setAuthed(false))}
            className="flex items-center gap-2 text-dim hover:text-bad transition-colors justify-self-start"
          >
            <SignOutIcon size={16} /> выйти
          </button>
        </div>
        <button
          onClick={() => post('/api/logout').finally(() => setAuthed(false))}
          className="md:hidden grid place-items-center w-12 shrink-0 text-dim hover:text-bad"
          aria-label="Выйти"
        >
          <SignOutIcon size={18} />
        </button>
      </aside>
      <main className="px-4 py-8 md:px-10 md:py-10 max-w-[1240px] w-full">
        {route === 'nodes' && <Nodes />}
        {route === 'subs' && <Subscriptions status={status} />}
        {route === 'docs' && <Docs status={status} />}
        {route === 'wizard' && <Wizard status={status} />}
        {route === 'log' && <Journal />}
        {route === 'settings' && <Settings status={status} onChange={refreshStatus} />}
      </main>
    </div>
  );
}

