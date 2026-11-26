import { useEffect, useState } from 'preact/hooks';
import { JSX } from 'preact';
import { Icon, IconName } from './Icons';

const PALETTE = [
  '#533e8c', '#1e786e', '#96405c', '#2b5ca0', '#785c2c',
  '#3a7840', '#8c5078', '#346496', '#604834', '#464660'
];

export function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function coverFallbackColor(seed: string): string {
  return PALETTE[hashSeed(seed || 'pola') % PALETTE.length];
}

export function headerGradientBg(hueHex: string | undefined, seed: string, light: boolean): string {
  const baseHex = hueHex && /^#[0-9a-f]{6}$/i.test(hueHex) ? hueHex : coverFallbackColor(seed);
  const r = parseInt(baseHex.slice(1, 3), 16);
  const g = parseInt(baseHex.slice(3, 5), 16);
  const b = parseInt(baseHex.slice(5, 7), 16);
  const target = light ? 255 : 18;
  const mix = light ? 0.72 : 0.42;
  const mr = Math.round(r + (target - r) * mix);
  const mg = Math.round(g + (target - g) * mix);
  const mb = Math.round(b + (target - b) * mix);
  return `linear-gradient(180deg, rgb(${mr}, ${mg}, ${mb}) 0%, var(--col-base) 100%)`;
}

export function Cover({
  url,
  seed,
  size,
  radius = 6,
  circle = false,
  contain = true,
  fallbackIcon = 'album',
  className = ''
}: {
  url?: string;
  seed: string;
  size: number | string;
  radius?: number;
  circle?: boolean;
  contain?: boolean;
  fallbackIcon?: IconName;
  className?: string;
}): JSX.Element {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  const showImg = Boolean(url) && !failed;
  const iconPx = typeof size === 'number' ? Math.max(14, Math.round(size * 0.42)) : 28;
  const boxRadius = circle ? '50%' : `${radius}px`;

  return (
    <div
      className={`cover-box ${contain && !circle ? 'contain' : 'crop'} ${circle ? 'circle' : ''} ${className}`}
      style={{
        width: typeof size === 'number' ? `${size}px` : size,
        height: typeof size === 'number' ? `${size}px` : size,
        borderRadius: boxRadius,
        backgroundColor: showImg ? 'transparent' : coverFallbackColor(seed)
      }}
    >
      {showImg ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          style={{ borderRadius: boxRadius }}
        />
      ) : (
        <span className="cover-ph-glyph" aria-hidden="true">
          <Icon name={fallbackIcon} size={iconPx} />
        </span>
      )}
    </div>
  );
}
