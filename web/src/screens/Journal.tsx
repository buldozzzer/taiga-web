import {useEffect, useState} from 'react';
import {get} from '../api';
import {PageHead, Panel} from '../components/ui';

interface Entry {
  at: number;
  level: 'info' | 'success' | 'warning' | 'error' | 'debug';
  text: string;
}

const COLOR = {info: 'text-ink', success: 'text-ok', warning: 'text-warn', error: 'text-bad', debug: 'text-dim'};

export function Journal() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [debug, setDebug] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      get<Entry[]>('/api/log').then(
        e => alive && setEntries(e),
        () => {},
      );
    void tick();
    const t = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const shown = entries.filter(e => debug || e.level !== 'debug').reverse();

  return (
    <>
      <PageHead
        title="Журнал"
        sub="Что делала панель с момента запуска. Ключи, пароли и ссылки сюда не пишутся."
        actions={
          <label className="flex items-center gap-2 text-[13px] text-dim cursor-pointer">
            <input type="checkbox" checked={debug} onChange={e => setDebug(e.target.checked)} className="accent-[var(--color-acid)]" />
            подробно
          </label>
        }
      />
      <Panel>
        {shown.length ? (
          <ol className="grid gap-1 text-[13px] max-h-[70dvh] overflow-auto">
            {shown.map((e, i) => (
              <li key={i} className="grid grid-cols-[72px_1fr] gap-3">
                <time className="text-dim tabular-nums">{new Date(e.at).toLocaleTimeString('ru-RU')}</time>
                <span className={`${COLOR[e.level]} break-words`}>{e.text}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-dim">
            Пока пусто<span className="blink text-acid">_</span>
          </p>
        )}
      </Panel>
    </>
  );
}
