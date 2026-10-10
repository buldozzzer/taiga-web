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
      <section className="hidden md:flex flex-col justify-between p-12 border-r border-wire bg-[radial-gradient(ellipse_at_10%_10%,rgb(242_233_78/0.10),transparent_55%),radial-gradient(ellipse_at_90%_100%,rgb(63_215_232/0.10),transparent_50%)]">
        <p className="font-display text-xl font-bold text-acid tracking-tight">
          TAIGA<span className="text-cyan">//</span>
        </p>
        <div className="grid gap-5 max-w-[30rem]">
          <h1 className="font-display text-5xl lg:text-6xl font-bold leading-[1.05] tracking-tight text-ink">
            Ноды, подписки <span className="text-acid glow-acid">и каналы</span> в одном месте
          </h1>
          <p className="text-dim leading-relaxed">Ставит выход на ваш сервер, создаёт документы на Яндекс Диске и раздаёт подписки клиентам Taiga.</p>
        </div>
        <p className="text-[12px] text-dim">
          доступ только для оператора<span className="blink text-acid">_</span>
        </p>
      </section>
      <section className="grid place-items-center p-4">
        <form onSubmit={submit} className="w-full max-w-sm grid gap-6 rise">
          <div className="md:hidden font-display text-2xl font-bold text-acid">
            TAIGA<span className="text-cyan">//</span>
          </div>
          <h2 className="font-display text-2xl text-ink">Вход</h2>
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
