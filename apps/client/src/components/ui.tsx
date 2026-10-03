import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Sparkle, X, LoaderCircle, CircleAlert } from 'lucide-react';

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'signal' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  pill?: boolean;
  block?: boolean;
  icon?: ReactNode;
  trailing?: ReactNode;
};
export function Button({
  variant = 'secondary',
  size = 'md',
  pill,
  block,
  icon,
  trailing,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cx(
        'btn',
        `btn--${variant}`,
        size !== 'md' && `btn--${size}`,
        pill && 'btn--pill',
        block && 'btn--block',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
      {trailing}
    </button>
  );
}

export function IconButton({
  label,
  size = 'md',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: 'xs' | 'sm' | 'md' }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx('icon-btn', size !== 'md' && `icon-btn--${size}`, className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Avatar({
  name,
  kind = 'human',
  size = 'md',
}: {
  name: string;
  kind?: 'human' | 'agent';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}) {
  return (
    <span
      className={cx(
        'avatar',
        kind === 'agent' && 'avatar--agent',
        size !== 'md' && `avatar--${size}`,
      )}
      aria-hidden="true"
    >
      {kind === 'agent' ? <Sparkle /> : (name.trim()[0] || '?').toUpperCase()}
    </span>
  );
}

export function Badge({
  tone = 'neutral',
  outline,
  children,
}: {
  tone?: 'neutral' | 'signal' | 'success' | 'warning' | 'danger';
  outline?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cx('badge', tone !== 'neutral' && `badge--${tone}`, outline && 'badge--outline')}
    >
      {children}
    </span>
  );
}

export function Dot({
  state,
  pulse,
}: {
  state?: 'live' | 'working' | 'waiting' | 'error';
  pulse?: boolean;
}) {
  return (
    <span className={cx('dot', state && `dot--${state}`, pulse && 'dot--pulse')} aria-hidden />
  );
}

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="kbd">{children}</kbd>;

export const Spinner = () => <LoaderCircle className="spinner" aria-hidden />;

export function Field({
  label,
  hint,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input className="input" {...rest} />
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

export function TextArea({
  label,
  hint,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <textarea className="input" {...rest} />
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

export function Callout({ tone, children }: { tone?: 'danger'; children: ReactNode }) {
  return (
    <p
      role={tone === 'danger' ? 'alert' : undefined}
      className={cx('callout', tone && `callout--${tone}`)}
    >
      {tone === 'danger' && <CircleAlert aria-hidden />}
      <span>{children}</span>
    </p>
  );
}

export function Dialog({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
  }, []);
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <section
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        className="dialog"
      >
        <header className="dialog__header">
          <h2 id="dialog-title" className="dialog__title">
            {title}
          </h2>
          <IconButton label="Close dialog" size="sm" onClick={onClose}>
            <X />
          </IconButton>
        </header>
        {description && <p className="dialog__description">{description}</p>}
        {children}
      </section>
    </div>
  );
}

/* Source chip: a pointer to an object that lives in a connected system. */
export function SourceChip({
  mark,
  id,
  label,
  onClick,
}: {
  mark: ReactNode;
  id?: string;
  label?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="chip__mark" aria-hidden>
        {mark}
      </span>
      {id && <span className="chip__id">{id}</span>}
      {label && <span className="chip__label">{label}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className="chip" onClick={onClick}>
      {content}
    </button>
  ) : (
    <span className="chip">{content}</span>
  );
}

export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="mark">
      <rect width="24" height="24" rx="7" fill="var(--surface-inverse)" />
      <path
        d="M7 17V11a4 4 0 0 1 8 0v6"
        fill="none"
        stroke="var(--text-inverse)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="18.6" cy="16.4" r="1.6" fill="var(--signal)" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <Mark />
      <span>neoms</span>
    </span>
  );
}
