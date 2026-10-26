import {ArrowRightIcon} from '@phosphor-icons/react';
import {useState} from 'react';
import {post} from '../api';
import {Button, Field, Input} from '../components/ui';

export function Login({onDone}: {onDone: () => void}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('/api/login', {password});
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[100dvh] grid md:grid-cols-[1.1fr_1fr]">
      <section className="hidden md:flex flex-col justify-between p-12 border-r border-wire bg-steel bg-[radial-gradient(ellipse_at_15%_10%,rgb(232_196_104/0.08),transparent_60%)]">
        <p className="font-display text-xl font-semibold tracking-[-0.02em] text-ink">
          Taiga<span className="text-acid">.</span>
        </p>
        <div className="grid gap-5 max-w-[30rem]">
          <h1 className="font-display text-5xl lg:text-[56px] font-semibold leading-[1.08] tracking-[-0.03em] text-ink">
            Ноды, подписки <span className="text-acid">и каналы</span> в одном месте
          </h1>
          <p className="text-dim leading-relaxed">Ставит выход на ваш сервер, создаёт документы на Яндекс Диске и раздаёт подписки клиентам Taiga.</p>
        </div>
        <p className="text-[13px] text-dim">Доступ только для оператора</p>
      </section>
      <section className="grid place-items-center p-4">
        <form onSubmit={submit} className="w-full max-w-sm grid gap-6 rise">
          <div className="md:hidden font-display text-2xl font-semibold tracking-[-0.02em] text-ink">
            Taiga<span className="text-acid">.</span>
          </div>
          <div className="grid gap-1">
            <h2 className="font-display text-2xl font-semibold text-ink">Вход</h2>
            <p className="text-dim">Введите пароль оператора панели.</p>
          </div>
          <Field label="Пароль оператора" error={error}>
            {id => <Input id={id} type="password" autoComplete="current-password" autoFocus value={password} onChange={e => setPassword(e.target.value)} />}
          </Field>
          <Button tone="acid" type="submit" busy={busy} disabled={!password}>
            Войти <ArrowRightIcon size={16} weight="bold" />
          </Button>
        </form>
      </section>
    </div>
  );
}
