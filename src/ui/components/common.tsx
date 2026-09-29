// Shared building blocks: framed surfaces, panel heads, buttons, pixel icons, bars, keycaps, sigil, embers.
import type { ComponentChildren, JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { useStore } from '../store';
import { clamp01 } from '../lib/format';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

interface FrameProps extends JSX.HTMLAttributes<HTMLDivElement> {
  children?: ComponentChildren;
  class?: string;
}

/** Iron-and-leather surface with riveted bronze corners. */
export function Frame({ children, class: klass, ...rest }: FrameProps) {
  return (
    <div {...rest} class={cx('fe-frame', klass)}>
      <i class="fe-frame__c fe-frame__c--tl" />
      <i class="fe-frame__c fe-frame__c--tr" />
      <i class="fe-frame__c fe-frame__c--bl" />
      <i class="fe-frame__c fe-frame__c--br" />
      {children}
    </div>
  );
}

export function PanelHead({ title, onClose }: { title: string; onClose?: () => void }) {
  return (
    <div class="fe-head">
      <span class="fe-head__rule" />
      <h2 class="fe-head__title" style={{ margin: 0 }}>
        {title}
      </h2>
      <span class="fe-head__rule fe-head__rule--r" />
      {onClose && (
        <button class="fe-btn fe-btn--icon fe-btn--ghost fe-head__close" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          <span class="fe-x" />
        </button>
      )}
    </div>
  );
}

type ButtonVariant = 'default' | 'ember' | 'danger' | 'ghost';

interface ButtonProps extends Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'size'> {
  variant?: ButtonVariant;
  size?: 'small' | 'normal' | 'large';
  busy?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  children?: ComponentChildren;
}

export function Button({
  variant = 'default',
  size = 'normal',
  busy,
  disabled,
  class: klass,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const store = useStore();
  const onClick = rest.onClick;
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || busy}
      class={cx('fe-btn', variant !== 'default' && `fe-btn--${variant}`, size !== 'normal' && `fe-btn--${size}`, klass as string)}
      onClick={(e) => {
        store.actions.uiSound('click');
        if (onClick) (onClick as (ev: typeof e) => void)(e);
      }}
    >
      {busy && <span class="fe-btn__spin" />}
      {children}
    </button>
  );
}

/**
 * Pixel-art icon from the art bundle. `cells` is the footprint (w x h cells); the image is requested at
 * 32 px per cell (the art's native resolution) and scaled by CSS with `image-rendering: pixelated`.
 */
export function PixelIcon({
  id,
  width,
  height,
  class: klass,
  style,
}: {
  id: string;
  width: number | string;
  height: number | string;
  class?: string;
  style?: JSX.CSSProperties;
}) {
  const store = useStore();
  const src = useMemo(() => store.art.icon(id, 32), [store, id]);
  if (!src) return <span class={cx('fe-px fe-icon-missing', klass)} style={{ width, height, ...style }} />;
  return <img class={cx('fe-px', klass)} src={src} alt="" draggable={false} style={{ width, height, ...style }} />;
}

/**
 * The Sorceress portrait at `size` px. Memoised per component: the art bundle caches only the most recent size,
 * so screens that show two sizes would otherwise re-encode the PNG on every render.
 */
export function usePortrait(size: number): string {
  const store = useStore();
  return useMemo(() => store.art.portrait(size), [store, size]);
}

export function Keycap({ children }: { children: ComponentChildren }) {
  return <kbd class="fe-key">{children}</kbd>;
}

export function Bar({ value, kind, class: klass }: { value: number; kind?: 'life' | 'xp' | 'ember'; class?: string }) {
  return (
    <div class={cx('fe-bar', kind && `fe-bar--${kind}`, klass)}>
      <div class="fe-bar__fill" style={{ width: `${clamp01(value) * 100}%` }} />
    </div>
  );
}

export function Sigil({ small }: { small?: boolean }) {
  return (
    <div class={cx('fe-sigil', small && 'fe-sigil--small')} aria-hidden="true">
      <div class="fe-sigil__ring" />
      <div class="fe-sigil__arc" />
      <div class="fe-sigil__arc fe-sigil__arc--inner" />
      <div class="fe-sigil__core" />
    </div>
  );
}

/** Rising ember particles (pure CSS; positions randomised once per mount — presentation only). */
export function Embers({ count = 26 }: { count?: number }) {
  const embers = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        '--x': `${(Math.random() * 100).toFixed(1)}%`,
        '--s': `${(2 + Math.random() * 3).toFixed(1)}px`,
        '--d': `${(7 + Math.random() * 9).toFixed(1)}s`,
        '--delay': `${(-Math.random() * 16).toFixed(1)}s`,
        '--drift': `${(Math.random() * 120 - 60).toFixed(0)}px`,
      })),
    [count],
  );
  return (
    <div class="fe-embers" aria-hidden="true">
      {embers.map((s, i) => (
        <span key={i} class="fe-ember" style={s as unknown as JSX.CSSProperties} />
      ))}
    </div>
  );
}

export function Divider() {
  return <div class="fe-divider" role="separator" />;
}

export function SectionTitle({ children }: { children: ComponentChildren }) {
  return <div class="fe-section-title">{children}</div>;
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  const store = useStore();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      class="fe-switch"
      onClick={() => {
        store.actions.uiSound('click');
        onChange(!checked);
      }}
    />
  );
}

export function Slider({ value, onInput, label }: { value: number; onInput: (v: number) => void; label: string }) {
  const pct = Math.round(clamp01(value) * 100);
  return (
    <input
      type="range"
      class="fe-range"
      min={0}
      max={100}
      step={1}
      value={pct}
      aria-label={label}
      style={{ '--fill': `${pct}%` } as unknown as JSX.CSSProperties}
      onInput={(e) => onInput(Number((e.currentTarget as HTMLInputElement).value) / 100)}
    />
  );
}
