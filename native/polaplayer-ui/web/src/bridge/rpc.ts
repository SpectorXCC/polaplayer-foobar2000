type EventHandler = (data: any) => void;

interface PendingRpc {
  resolve: (data: any) => void;
  reject: (err: Error) => void;
  timer: number;
}

const listeners = new Map<string, Set<EventHandler>>();
const pending = new Map<number, PendingRpc>();
let nextId = 1;
let initialized = false;

function getWebView(): { postMessage: (msg: unknown) => void; addEventListener: (ev: string, fn: (e: any) => void) => void } | null {
  try {
    const wv = (window as unknown as { chrome?: { webview?: any } }).chrome?.webview;
    return wv && typeof wv.postMessage === 'function' ? wv : null;
  } catch {
    return null;
  }
}

export function initBridge(): void {
  if (initialized) return;
  initialized = true;
  const wv = getWebView();
  if (!wv) return;
  wv.addEventListener('message', ({ data }: { data: any }) => {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'rpc-res') {
      const entry = pending.get(Number(data.id));
      if (!entry) return;
      pending.delete(Number(data.id));
      window.clearTimeout(entry.timer);
      if (data.ok) entry.resolve(data.data);
      else entry.reject(new Error(String(data.error || 'RPC failed')));
      return;
    }
    if (data.type === 'event' && typeof data.event === 'string') {
      emitEvent(data.event, data.data);
      return;
    }
    // Also forward direct fullscreen messages if emitted
    if (typeof data.type === 'string') {
      emitEvent(`raw:${data.type}`, data);
    }
  });
}

function emitEvent(name: string, payload: unknown): void {
  const set = listeners.get(name);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(payload);
    } catch {
      // Keep other subscribers running
    }
  }
}

export function onHostEvent<T = any>(name: string, fn: (data: T) => void): () => void {
  initBridge();
  let set = listeners.get(name);
  if (!set) {
    set = new Set();
    listeners.set(name, set);
  }
  set.add(fn as EventHandler);
  return () => {
    set?.delete(fn as EventHandler);
  };
}

export function postRaw(msg: Record<string, unknown>): void {
  const wv = getWebView();
  if (wv) wv.postMessage(msg);
}

export function rpc<T = any>(method: string, params: Record<string, unknown> = {}, timeoutMs = 15000): Promise<T> {
  initBridge();
  const wv = getWebView();
  if (!wv) return Promise.reject(new Error('WebView bridge unavailable'));
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id);
      reject(new Error(`RPC timeout: ${method}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    wv.postMessage({ type: 'rpc', id, method, params });
  });
}

export function signalReady(): void {
  initBridge();
  postRaw({ type: 'ready' });
}

export function sendDroppedFiles(
  targetKind: 'new' | 'playlist',
  playlistId: string,
  files: FileList | null | undefined
): boolean {
  if (!files || files.length === 0) return false;
  try {
    const wv = (window as unknown as {
      chrome?: {
        webview?: {
          postMessageWithAdditionalObjects?: (msg: unknown, objs: unknown[]) => void;
        };
      };
    }).chrome?.webview;
    if (!wv || typeof wv.postMessageWithAdditionalObjects !== 'function') return false;
    wv.postMessageWithAdditionalObjects(
      { type: 'pola.drop', targetKind, playlistId },
      Array.from(files)
    );
    return true;
  } catch {
    return false;
  }
}
