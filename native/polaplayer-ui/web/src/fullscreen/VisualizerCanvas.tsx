import { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { TrackInfo } from '../types';

export type VizStyle = 'bars' | 'radial';

export interface VisualizerCanvasProps {
  bands: number[];
  bass: number;
  style: VizStyle;
  track: TrackInfo;
  onToggleStyle: () => void;
}

const BAND_COUNT = 72;
const RADIAL_COUNT = 36;

function bandColor(v: number): string {
  const t = Math.max(0, Math.min(1, v * 1.3));
  // Blend Spotify green (#1ed760 = 30,215,96) -> mint highlight (#d2f8e0 = 210,248,224)
  const r = Math.round(30 + (210 - 30) * t);
  const g = Math.round(215 + (248 - 215) * t);
  const b = Math.round(96 + (224 - 96) * t);
  return `rgb(${r},${g},${b})`;
}

export function VisualizerCanvas({
  bands,
  bass,
  style,
  track,
  onToggleStyle
}: VisualizerCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bandsRef = useRef<number[]>(bands);
  const bassRef = useRef<number>(bass);
  const styleRef = useRef<VizStyle>(style);
  const imgRef = useRef<{ url: string; img: HTMLImageElement; ready: boolean } | null>(null);

  bandsRef.current = bands;
  bassRef.current = bass;
  styleRef.current = style;

  useEffect(() => {
    const url = track.coverUrl || '';
    if (!url) {
      imgRef.current = null;
      return;
    }
    if (imgRef.current?.url === url) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const entry = { url, img, ready: false };
    img.onload = () => {
      entry.ready = true;
    };
    img.src = url;
    imgRef.current = entry;
  }, [track.coverUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w > 10 && h > 10) {
        const pw = Math.round(w * dpr);
        const ph = Math.round(h * dpr);
        if (canvas.width !== pw || canvas.height !== ph) {
          canvas.width = pw;
          canvas.height = ph;
        }
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);

        const curBands = bandsRef.current;
        const curBass = bassRef.current;

        if (styleRef.current === 'radial') {
          const cx = w / 2;
          const cy = h / 2;
          const half = Math.min(h / 2, w / 2 - 24);
          const R = Math.max(80, half * 0.92);
          const r0 = R * 0.44 * (1 + curBass * 0.06);
          const len = Math.max(16, R - r0);
          const artR = Math.max(24, r0 - 18);

          // Soft bass halo around album center
          if (curBass > 0.04) {
            ctx.beginPath();
            ctx.arc(cx, cy, artR + 8 + curBass * 12, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(30, 215, 96, ${0.14 * curBass})`;
            ctx.fill();
          }

          // Center circular cover art
          ctx.save();
          ctx.beginPath();
          ctx.arc(cx, cy, artR, 0, Math.PI * 2);
          ctx.clip();
          const artEntry = imgRef.current;
          if (artEntry && artEntry.ready && artEntry.img.naturalWidth > 0) {
            const iw = artEntry.img.naturalWidth;
            const ih = artEntry.img.naturalHeight;
            const scale = Math.max((artR * 2) / iw, (artR * 2) / ih);
            const dw = iw * scale;
            const dh = ih * scale;
            ctx.drawImage(artEntry.img, cx - dw / 2, cy - dh / 2, dw, dh);
          } else {
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            ctx.fillRect(cx - artR, cy - artR, artR * 2, artR * 2);
          }
          ctx.restore();

          // 36 symmetric radial spokes per side
          const spokeW = Math.max(3, Math.min(8, (Math.PI * r0) / RADIAL_COUNT * 0.62));
          for (let i = 0; i < RADIAL_COUNT; i++) {
            const per = BAND_COUNT / RADIAL_COUNT;
            const k0 = Math.floor(i * per);
            const k1 = Math.max(k0 + 1, Math.floor((i + 1) * per));
            let v = 0;
            for (let k = k0; k < k1 && k < curBands.length; k++) {
              if ((curBands[k] || 0) > v) v = curBands[k] || 0;
            }
            const spokeLen = Math.max(spokeW, v * len);
            const angleRad = ((i + 0.5) * Math.PI) / RADIAL_COUNT;
            ctx.fillStyle = bandColor(v);
            for (const side of [-1, 1]) {
              ctx.save();
              ctx.translate(cx, cy);
              ctx.rotate(side * angleRad);
              ctx.beginPath();
              ctx.roundRect(-spokeW / 2, -r0 - spokeLen, spokeW, spokeLen, spokeW / 2);
              ctx.fill();
              ctx.restore();
            }
          }
        } else {
          // 72 mirrored spectrum bars across hairline
          const padX = Math.min(48, w * 0.05);
          const innerW = Math.max(120, w - padX * 2);
          const cy = h / 2;
          const cell = innerW / BAND_COUNT;
          const bw = Math.max(3, cell / 1.55);
          const x0 = padX + (cell - bw) / 2;
          const maxHalfH = (h / 2) * 0.64;

          ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(padX, cy);
          ctx.lineTo(w - padX, cy);
          ctx.stroke();

          for (let i = 0; i < BAND_COUNT; i++) {
            const v = curBands[i] || 0;
            const bh = Math.max(2, v * maxHalfH);
            const bx = x0 + i * cell;
            const rad = Math.min(bw / 2, bh);
            ctx.fillStyle = bandColor(v);
            ctx.beginPath();
            ctx.roundRect(bx, cy - bh, bw, bh * 2, rad);
            ctx.fill();
          }
        }
        ctx.restore();
      }
      raf = window.requestAnimationFrame(draw);
    };

    raf = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fs-viz-canvas"
      onClick={onToggleStyle}
      title={style === 'bars' ? 'Bars · Click to switch' : 'Radial Ring · Click to switch'}
    />
  );
}
