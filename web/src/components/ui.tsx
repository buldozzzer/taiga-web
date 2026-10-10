import {CheckIcon, CopySimpleIcon, WarningIcon, XIcon} from '@phosphor-icons/react';
import {type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes, createContext, useCallback, useContext, useEffect, useId, useState} from 'react';
import {copy} from '../api';

type Tone = 'acid' | 'ghost' | 'danger';

export function Button({tone = 'ghost', busy, className = '', children, ...rest}: ButtonHTMLAttributes<HTMLButtonElement> & {tone?: Tone; busy?: boolean}) {
  const tones: Record<Tone, string> = {
    acid: 'bg-acid text-void hover:bg-[#fff36b] font-semibold',
    ghost: 'bg-wire/60 text-ink hover:bg-wire hover:text-acid',
    danger: 'bg-bad/15 text-bad hover:bg-bad hover:text-void',
  };
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={`chamfer-sm inline-flex items-center justify-center gap-2 whitespace-nowrap px-4 h-10 text-[13px] uppercase tracking-[0.08em] transition-[background,color,transform] duration-200 active:translate-y-px disabled:opacity-40 disabled:pointer-events-none ${tones[tone]} ${busy ? 'scan' : ''} ${className}`}
    >
      {children}
    </button>
  );
}

export function IconButton({label, children, className = '', ...rest}: ButtonHTMLAttributes<HTMLButtonElement> & {label: string}) {
  return (
    <button
      {...rest}
      title={label}
      aria-label={label}
      className={`chamfer-sm grid place-items-center size-9 bg-wire/50 text-dim hover:text-acid hover:bg-wire transition-colors disabled:opacity-40 disabled:pointer-events-none ${className}`}
    >
      {children}
    </button>
  );
}

/** A labelled field: label above, hint and error below. */
export function Field({label, hint, error, children}: {label: string; hint?: ReactNode; error?: string; children: (id: string) => ReactNode}) {
  const id = useId();
  return (
    <div className="grid gap-2 content-start">
      <label htmlFor={id} className="text-[12px] uppercase tracking-[0.12em] text-dim">
        {label}
      </label>
      {children(id)}
      {hint && !error && <p className="text-[12px] text-dim leading-relaxed">{hint}</p>}
      {error && <p className="text-[12px] text-bad">{error}</p>}
    </div>
  );
}

const inputClass =
  'chamfer-sm w-full bg-void/80 border-0 px-3 h-10 text-ink placeholder:text-dim/70 outline-none ring-1 ring-inset ring-wire focus:ring-cyan transition-shadow disabled:opacity-50 disabled:cursor-not-allowed';

export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} className={`${inputClass} ${props.className ?? ''}`} />;

export const TextArea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...props} className={`${inputClass} h-auto py-2 leading-relaxed resize-y ${props.className ?? ''}`} />
);

export function Toggle({checked, onChange, label, hint, disabled}: {checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean}) {
  return (
    <label className={`flex items-start gap-3 cursor-pointer select-none ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={e => onChange(e.target.checked)} disabled={disabled} />
      <span className="chamfer-sm mt-0.5 grid place-items-center size-5 shrink-0 bg-wire peer-checked:bg-acid peer-focus-visible:ring-2 peer-focus-visible:ring-cyan text-void transition-colors">
        {checked && <CheckIcon size={13} weight="bold" />}
      </span>
      <span className="grid gap-1">
        <span className="text-ink">{label}</span>
        {hint && <span className="text-[12px] text-dim leading-relaxed">{hint}</span>}
      </span>
    </label>
  );
}

export function Panel({children, className = '', style, flush}: {children: ReactNode; className?: string; style?: React.CSSProperties; flush?: boolean}) {
  return (
    <div className={`frame chamfer ${className}`} style={style}>
      <div className={`face chamfer h-full ${flush ? '' : 'p-5 md:p-6'}`}>{children}</div>
    </div>
  );
}

export function PageHead({title, sub, actions}: {title: string; sub?: ReactNode; actions?: ReactNode}) {
  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between mb-8">
      <div className="grid gap-2">
        <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight leading-[1.1] glow-acid text-acid">{title}</h1>
        {sub && <p className="text-dim max-w-[65ch] leading-relaxed">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 shrink-0 [&>*]:flex-1 sm:[&>*]:flex-none">{actions}</div>}
    </header>
  );
}

export function Banner({tone, children, onClose}: {tone: 'error' | 'warn' | 'info' | 'ok'; children: ReactNode; onClose?: () => void}) {
  const tones = {
    error: 'border-bad text-bad bg-bad/8',
    warn: 'border-warn text-warn bg-warn/8',
    info: 'border-cyan text-cyan bg-cyan/8',
    ok: 'border-ok text-ok bg-ok/8',
  };
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-3 border-l-2 px-4 py-3 ${tones[tone]}`}>
      {(tone === 'error' || tone === 'warn') && <WarningIcon size={18} className="mt-px shrink-0" />}
      <div className="flex-1 leading-relaxed">{children}</div>
      {onClose && (
        <button onClick={onClose} aria-label="Закрыть" className="opacity-70 hover:opacity-100">
          <XIcon size={16} />
        </button>
      )}
    </div>
  );
}

/** A secret or a link shown in mono with a copy button. */
export function CopyLine({value, label = 'Копировать', mask}: {value: string; label?: string; mask?: boolean}) {
  const toast = useToast();
  const [shown, setShown] = useState(!mask);
  return (
    <div className="chamfer-sm flex items-center gap-2 bg-void/80 ring-1 ring-inset ring-wire pl-3 pr-1 h-10 min-w-0">
      <button type="button" onClick={() => mask && setShown(s => !s)} className={`flex-1 min-w-0 truncate text-left text-[13px] ${mask ? 'cursor-pointer' : 'cursor-text'} text-cyan`} title={mask && !shown ? 'Показать' : value}>
        {shown ? value : '•'.repeat(Math.min(32, value.length))}
      </button>
      <IconButton
        label={label}
        className="size-8"
        onClick={async () => toast((await copy(value)) ? 'Скопировано' : 'Не удалось скопировать: браузер не дал доступ к буферу')}
      >
        <CopySimpleIcon size={16} />
      </IconButton>
    </div>
  );
}

/** Under a field .env sets: the page cannot change it. */
export const EnvNote = ({name}: {name: string}) => (
  <span className="text-cyan">
    Задано в .env: <code>{name}</code>. Меняется там, после перезапуска панели.
  </span>
);

export function StatusMark({status, children}: {status: 'ok' | 'fail' | 'warn' | 'idle' | 'live'; children: ReactNode}) {
  const color = {ok: 'text-ok', fail: 'text-bad', warn: 'text-warn', idle: 'text-dim', live: 'text-cyan'}[status];
  const sign = {ok: '[OK]', fail: '[ERR]', warn: '[!!]', idle: '[--]', live: '[..]'}[status];
  return (
    <span className={`inline-flex items-baseline gap-2 text-[12px] ${color}`}>
      <span className="font-semibold">{sign}</span>
      <span className="text-ink/90">{children}</span>
    </span>
  );
}

export function Empty({title, children, action}: {title: string; children?: ReactNode; action?: ReactNode}) {
  return (
    <div className="frame chamfer">
      <div className="face chamfer grid gap-4 justify-items-start p-8 md:p-10">
        <p className="font-display text-xl text-ink">{title}</p>
        {children && <p className="text-dim max-w-[60ch] leading-relaxed">{children}</p>}
        {action}
      </div>
    </div>
  );
}

export function Skeleton({rows = 3}: {rows?: number}) {
  return (
    <div className="grid gap-3" aria-busy="true" aria-label="Загрузка">
      {Array.from({length: rows}, (_, i) => (
        <div key={i} className="chamfer h-20 bg-plate scan" />
      ))}
    </div>
  );
}

/** A confirm dialog in the page's frame, for actions that cannot be taken back. */
export function Confirm({title, children, confirm, tone = 'danger', onConfirm, onCancel}: {
  title: string;
  children: ReactNode;
  confirm: string;
  tone?: Tone;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-void/80 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-label={title} onClick={onCancel}>
      <div className="w-full max-w-md rise" onClick={e => e.stopPropagation()}>
        <Panel>
          <h2 className="font-display text-xl text-ink mb-3">{title}</h2>
          <div className="text-dim leading-relaxed mb-6">{children}</div>
          <div className="flex justify-end gap-2">
            <Button onClick={onCancel}>Отмена</Button>
            <Button tone={tone} onClick={onConfirm} autoFocus>
              {confirm}
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

// ---- toasts: transient confirmations only ----

const ToastContext = createContext<(text: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({children}: {children: ReactNode}) {
  const [items, setItems] = useState<{id: number; text: string}[]>([]);
  const push = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setItems(list => [...list.slice(-2), {id, text}]);
    setTimeout(() => setItems(list => list.filter(t => t.id !== id)), 2600);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 grid gap-2" aria-live="polite">
        {items.map(t => (
          <div key={t.id} className="chamfer-sm rise bg-acid text-void px-4 py-2 text-[13px] font-semibold">
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
