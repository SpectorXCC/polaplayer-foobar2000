import { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { DupPromptState, NavConnectionState, PlaylistSummary, SettingsState } from '../types';
import { rpc } from '../bridge/rpc';
import { fmtNum, t, LangCode } from '../i18n/strings';

export interface SetupModalProps {
  open: boolean;
  lang: LangCode;
  settings: SettingsState;
  navConnection: NavConnectionState;
  onClose: () => void;
}

interface ServerDraft {
  id: string;
  name: string;
  server: string;
  user: string;
  password: string;
  hasSavedPassword?: boolean;
}

function buildInitialDrafts(s: SettingsState): { drafts: ServerDraft[]; activeId: string } {
  if (s.servers && s.servers.length > 0) {
    const drafts = s.servers.map((sv) => ({
      id: sv.id,
      name: sv.name || sv.server,
      server: sv.server,
      user: sv.user,
      password: '',
      hasSavedPassword: true
    }));
    const activeId = drafts.some((d) => d.id === s.activeServerId) ? (s.activeServerId as string) : drafts[0].id;
    return { drafts, activeId };
  }
  if (s.server || s.user) {
    return {
      drafts: [{ id: 'srv-1', name: s.server || 'Server 1', server: s.server, user: s.user, password: '', hasSavedPassword: s.configured }],
      activeId: 'srv-1'
    };
  }
  return {
    drafts: [{ id: 'srv-1', name: '', server: '', user: '', password: '', hasSavedPassword: false }],
    activeId: 'srv-1'
  };
}

function isOutsideDialogRect(ev: MouseEvent, el: HTMLDialogElement): boolean {
  if (ev.target !== el) return false;
  const r = el.getBoundingClientRect();
  return ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom;
}

/** Coordinates modal open/close state, Escape handling, and safe backdrop light-dismiss. */
function useModalDialog(open: boolean, onDismiss: () => void, lightDismiss = true) {
  const ref = useRef<HTMLDialogElement>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const pressedOutsideRef = useRef(false);

  const dismiss = () => {
    if (ref.current) ref.current.returnValue = '';
    dismissRef.current();
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open) {
      if (lightDismiss) el.setAttribute('closedby', 'any');
      else el.removeAttribute('closedby');
      if (!el.open) {
        el.returnValue = '';
        el.showModal();
      }
    } else if (el.open) {
      el.close();
    }
  }, [open, lightDismiss]);

  return {
    ref,
    dismiss,
    dialogProps: {
      onCancel: (e: Event) => {
        e.preventDefault();
        dismiss();
      },
      onClose: () => {
        if (openRef.current) dismissRef.current();
      },
      onPointerDown: (e: PointerEvent) => {
        pressedOutsideRef.current = lightDismiss && Boolean(ref.current && isOutsideDialogRect(e, ref.current));
      },
      onClick: (e: MouseEvent) => {
        const shouldDismiss =
          lightDismiss && pressedOutsideRef.current && Boolean(ref.current && isOutsideDialogRect(e, ref.current));
        pressedOutsideRef.current = false;
        if (shouldDismiss) dismiss();
      }
    }
  };
}

export function SetupDialog({ open, lang, settings, navConnection, onClose }: SetupModalProps): JSX.Element {
  const { ref, dismiss: handleClose, dialogProps } = useModalDialog(open, onClose);
  const [themeMode, setThemeMode] = useState<0 | 1 | 2>(settings.themeMode);
  const [languageMode, setLanguageMode] = useState<'auto' | 'en' | 'zh-CN'>(settings.languageMode);
  const [sources, setSources] = useState<'local' | 'both'>(settings.sources);
  const [drafts, setDrafts] = useState<ServerDraft[]>(() => buildInitialDrafts(settings).drafts);
  const [selectedId, setSelectedId] = useState<string>(() => buildInitialDrafts(settings).activeId);
  const [importNote, setImportNote] = useState('');
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    if (open) {
      setThemeMode(settings.themeMode);
      setLanguageMode(settings.languageMode);
      setSources(settings.sources);
      const init = buildInitialDrafts(settings);
      setDrafts(init.drafts);
      setSelectedId(init.activeId);
      setImportNote('');
      setErrMsg('');
    }
  }, [open, settings]);

  const currentDraft = drafts.find((d) => d.id === selectedId) || drafts[0];

  const updateCurrent = (patch: Partial<ServerDraft>) => {
    if (!currentDraft) return;
    setDrafts((prev) => prev.map((d) => (d.id === currentDraft.id ? { ...d, ...patch } : d)));
  };

  const addServer = () => {
    const newId = `srv-${Date.now().toString(36)}`;
    const next: ServerDraft = {
      id: newId,
      name: `Server ${drafts.length + 1}`,
      server: '',
      user: '',
      password: '',
      hasSavedPassword: false
    };
    setDrafts((prev) => [...prev, next]);
    setSelectedId(newId);
    setErrMsg('');
  };

  const removeCurrent = () => {
    if (drafts.length <= 1 || !currentDraft) return;
    const remaining = drafts.filter((d) => d.id !== currentDraft.id);
    setDrafts(remaining);
    setSelectedId(remaining[0].id);
  };

  const handleImportFoo = async () => {
    setImporting(true);
    setImportNote('');
    setErrMsg('');
    try {
      const res = await rpc<{ imported: number; settings: SettingsState }>('settings.importFooNavidrome');
      if (res.imported > 0 && res.settings) {
        const init = buildInitialDrafts(res.settings);
        setDrafts(init.drafts);
        setSelectedId(init.activeId);
        setImportNote(t(lang, 'setup.imported_ok', res.imported));
      } else {
        setImportNote(t(lang, 'setup.import_none'));
      }
    } catch {
      setImportNote(t(lang, 'setup.import_none'));
    } finally {
      setImporting(false);
    }
  };

  const handleTest = () => {
    if (!currentDraft) return;
    setErrMsg('');
    void rpc('settings.testServer', {
      id: currentDraft.id,
      server: currentDraft.server,
      user: currentDraft.user,
      password: currentDraft.password
    });
  };

  const handleSave = async (ev: Event) => {
    ev.preventDefault();
    setSaving(true);
    setErrMsg('');
    try {
      await rpc('settings.save', {
        themeMode,
        languageMode,
        sources,
        ...(sources === 'both'
          ? {
              activeId: currentDraft?.id || '',
              servers: drafts.map((d) => ({
                id: d.id,
                name: d.name.trim() || d.server.trim(),
                server: d.server.trim(),
                user: d.user.trim(),
                password: d.password
              }))
            }
          : {})
      });
      setSaving(false);
      handleClose();
    } catch (e: unknown) {
      setSaving(false);
      setErrMsg(e instanceof Error ? e.message : t(lang, 'setup.nav_failed'));
    }
  };

  const connLabel =
    navConnection.status === 'testing'
      ? t(lang, 'setup.nav_testing')
      : navConnection.status === 'connected'
        ? t(lang, 'setup.nav_connected')
        : navConnection.status === 'failed'
          ? navConnection.error || t(lang, 'setup.nav_failed')
          : navConnection.status === 'unconfigured'
            ? t(lang, 'setup.nav_unconfigured')
            : t(lang, 'setup.nav_idle');

  return (
    <dialog
      ref={ref}
      className="pola-dialog"
      aria-labelledby="setup-dlg-title"
      {...dialogProps}
    >
      <form className="dlg-form" onSubmit={(e) => void handleSave(e)}>
        <div className="dlg-head">
          <div className="dlg-eyebrow">{t(lang, 'setup.progress')}</div>
          <h2 id="setup-dlg-title">{t(lang, 'setup.welcome')}</h2>
          <p className="dlg-sub">{t(lang, 'setup.choose_source')}</p>
        </div>

        <div className="dlg-section">
          <div className="dlg-label">{t(lang, 'setup.appearance')}</div>
          <div className="seg-row">
            {([0, 1, 2] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`seg-btn ${themeMode === m ? 'active' : ''}`}
                onClick={() => setThemeMode(m)}
              >
                {m === 0 ? t(lang, 'setup.system') : m === 1 ? t(lang, 'setup.dark') : t(lang, 'setup.light')}
              </button>
            ))}
          </div>
          <div className="seg-row">
            {(['auto', 'en', 'zh-CN'] as const).map((l) => (
              <button
                key={l}
                type="button"
                className={`seg-btn ${languageMode === l ? 'active' : ''}`}
                onClick={() => setLanguageMode(l)}
              >
                {l === 'auto' ? t(lang, 'setup.lang_auto') : l === 'en' ? t(lang, 'setup.lang_en') : t(lang, 'setup.lang_zh')}
              </button>
            ))}
          </div>
        </div>

        <div className="dlg-section">
          <div className="dlg-label">{t(lang, 'setup.libraries')}</div>
          <div className="source-cards">
            <button
              type="button"
              className={`source-card ${sources === 'local' ? 'active' : ''}`}
              onClick={() => setSources('local')}
            >
              <strong>{t(lang, 'source.local')}</strong>
              <span>{t(lang, 'setup.local_desc')}</span>
            </button>
            <button
              type="button"
              className={`source-card ${sources === 'both' ? 'active' : ''}`}
              onClick={() => setSources('both')}
            >
              <strong>{t(lang, 'setup.both')}</strong>
              <span>{t(lang, 'setup.both_desc')}</span>
            </button>
          </div>
        </div>

        {sources === 'both' && currentDraft && (
          <div className="dlg-section">
            <div className="srv-bar">
              <div className="dlg-label">{t(lang, 'setup.servers')}</div>
              <div className="srv-bar-actions">
                <button
                  type="button"
                  className="mini-btn"
                  disabled={importing}
                  onClick={() => void handleImportFoo()}
                >
                  {t(lang, 'setup.import_foo_nav')}
                </button>
                <button type="button" className="mini-btn" onClick={addServer}>
                  {t(lang, 'setup.add_server')}
                </button>
              </div>
            </div>

            {drafts.length > 0 && (
              <div className="srv-chips">
                {drafts.map((d, idx) => (
                  <button
                    key={d.id}
                    type="button"
                    className={`pill-tab ${d.id === currentDraft.id ? 'active' : ''}`}
                    onClick={() => setSelectedId(d.id)}
                  >
                    {d.name || d.server || `Server ${idx + 1}`}
                  </button>
                ))}
                {drafts.length > 1 && (
                  <button type="button" className="mini-btn danger" onClick={removeCurrent}>
                    {t(lang, 'setup.remove_server')}
                  </button>
                )}
              </div>
            )}

            {importNote && <div className="conn-status connected">{importNote}</div>}

            <label className="field-label">
              <span>{t(lang, 'setup.server_name')}</span>
              <input
                type="text"
                className="field-input"
                placeholder="Home Server"
                value={currentDraft.name}
                onInput={(e) => updateCurrent({ name: (e.currentTarget as HTMLInputElement).value })}
              />
            </label>
            <label className="field-label">
              <span>{t(lang, 'setup.server_url')}</span>
              <input
                type="url"
                className="field-input"
                placeholder="https://music.example.com"
                value={currentDraft.server}
                onInput={(e) => updateCurrent({ server: (e.currentTarget as HTMLInputElement).value })}
              />
            </label>
            <label className="field-label">
              <span>{t(lang, 'setup.username')}</span>
              <input
                type="text"
                className="field-input"
                value={currentDraft.user}
                onInput={(e) => updateCurrent({ user: (e.currentTarget as HTMLInputElement).value })}
              />
            </label>
            <label className="field-label">
              <span>{t(lang, 'setup.password')}</span>
              <input
                type="password"
                className="field-input"
                placeholder={currentDraft.hasSavedPassword ? t(lang, 'setup.keep_password') : ''}
                value={currentDraft.password}
                onInput={(e) => updateCurrent({ password: (e.currentTarget as HTMLInputElement).value })}
              />
            </label>

            <div className="conn-row">
              <button type="button" className="action-outline-btn" onClick={handleTest}>
                {t(lang, 'setup.test')}
              </button>
              <span className={`conn-status ${navConnection.status}`}>{errMsg || connLabel}</span>
            </div>
          </div>
        )}

        <div className="dlg-footer split">
          <button
            type="button"
            className="mini-btn"
            onClick={() => void rpc('settings.openPreferences')}
          >
            {t(lang, 'setup.preferences')}
          </button>
          <div className="dlg-footer-right">
            <button type="button" className="action-outline-btn" onClick={handleClose}>
              {t(lang, 'btn.cancel')}
            </button>
            <button type="submit" className="primary-btn" disabled={saving}>
              {t(lang, 'btn.save')}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}

export interface PlaylistPromptProps {
  open: boolean;
  mode: 'create' | 'rename';
  lang: LangCode;
  initialName: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}

export function PlaylistPromptDialog({
  open,
  mode,
  lang,
  initialName,
  onSubmit,
  onClose
}: PlaylistPromptProps): JSX.Element {
  const { ref, dismiss: handleClose, dialogProps } = useModalDialog(open, onClose);
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (open) {
      setName(initialName);
      setErr('');
      window.setTimeout(() => inputRef.current?.select(), 10);
    }
  }, [open, initialName]);

  const handleSubmit = async (ev: Event) => {
    ev.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await onSubmit(trimmed);
      handleClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed');
    }
  };

  return (
    <dialog
      ref={ref}
      className="pola-dialog small"
      aria-labelledby="pl-prompt-title"
      {...dialogProps}
    >
      <form className="dlg-form" onSubmit={(e) => void handleSubmit(e)}>
        <h2 id="pl-prompt-title">
          {mode === 'rename' ? t(lang, 'dlg.rename_pl') : t(lang, 'dlg.create_pl')}
        </h2>
        <input
          ref={inputRef}
          type="text"
          className="field-input"
          value={name}
          maxLength={160}
          onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
        />
        {err && <div className="dlg-err">{err}</div>}
        <div className="dlg-footer">
          <button type="button" className="action-outline-btn" onClick={handleClose}>
            {t(lang, 'btn.cancel')}
          </button>
          <button type="submit" className="primary-btn">
            {mode === 'rename' ? t(lang, 'btn.rename') : t(lang, 'btn.create')}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export interface DeletePlaylistDialogProps {
  lang: LangCode;
  playlist: PlaylistSummary | null;
  isNavidrome: boolean;
  onConfirm: (pl: PlaylistSummary) => Promise<void>;
  onClose: () => void;
}

export function DeletePlaylistDialog({
  lang,
  playlist,
  isNavidrome,
  onConfirm,
  onClose
}: DeletePlaylistDialogProps): JSX.Element {
  const { ref, dismiss: handleClose, dialogProps } = useModalDialog(Boolean(playlist), onClose);

  return (
    <dialog
      ref={ref}
      className="pola-dialog small"
      aria-labelledby="pl-del-title"
      {...dialogProps}
    >
      <div className="dlg-form">
        <h2 id="pl-del-title">{t(lang, 'dlg.del_pl_title')}</h2>
        <p className="dlg-sub">
          {playlist
            ? t(lang, isNavidrome ? 'dlg.del_nv_pl_msg' : 'dlg.del_pl_msg', playlist.name)
            : ''}
        </p>
        <div className="dlg-footer">
          <button type="button" className="action-outline-btn" onClick={handleClose}>
            {t(lang, 'btn.cancel')}
          </button>
          <button
            type="button"
            className="primary-btn danger"
            onClick={() => {
              if (!playlist) return;
              void onConfirm(playlist).then(handleClose);
            }}
          >
            {t(lang, 'btn.delete')}
          </button>
        </div>
      </div>
    </dialog>
  );
}

export interface PopupMenuItem {
  label: string;
  danger?: boolean;
  accent?: boolean;
  sepBefore?: boolean;
  onClick?: () => void;
  submenu?: PopupMenuItem[];
}

export function ContextPopupMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number;
  y: number;
  items: PopupMenuItem[];
  onClose: () => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [openSubIdx, setOpenSubIdx] = useState<number | null>(null);

  useEffect(() => {
    setOpenSubIdx(null);
  }, [x, y, items]);

  useEffect(() => {
    const close = () => onClose();
    const onDown = (ev: MouseEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('resize', close);
    };
  }, [onClose]);

  const sepCount = items.filter((it) => it.sepBefore).length;
  const left = Math.min(Math.max(8, x), Math.max(8, window.innerWidth - 268));
  const estHeight = items.length * 36 + sepCount * 10 + 20;
  const top = Math.min(Math.max(8, y), Math.max(8, window.innerHeight - estHeight));
  const openSubRight = left + 260 + 224 <= window.innerWidth;

  return (
    <div ref={ref} className="popup-menu" style={{ left: `${left}px`, top: `${top}px` }} role="menu">
      {items.map((item, idx) => {
        const subFlipUp = top + idx * 36 + 240 > window.innerHeight;
        return (
        <div key={idx} className="popup-entry-wrap">
          {item.sepBefore && <div className="popup-sep" role="separator" />}
          <button
            type="button"
            role="menuitem"
            aria-haspopup={item.submenu ? 'menu' : undefined}
            aria-expanded={item.submenu ? openSubIdx === idx : undefined}
            className={`popup-item ${item.danger ? 'danger' : ''} ${item.accent ? 'accent' : ''} ${item.submenu ? 'has-sub' : ''}`}
            onMouseEnter={() => setOpenSubIdx(item.submenu ? idx : null)}
            onClick={() => {
              if (item.submenu) {
                setOpenSubIdx((cur) => (cur === idx ? null : idx));
                return;
              }
              item.onClick?.();
              onClose();
            }}
          >
            <span className="truncate">{item.label}</span>
            {item.submenu && <span className="popup-arrow">▸</span>}
          </button>

          {item.submenu && openSubIdx === idx && (
            <div
              className="popup-menu popup-submenu scroll-area"
              style={{
                ...(openSubRight ? { left: 'calc(100% + 2px)' } : { right: 'calc(100% + 2px)' }),
                ...(subFlipUp ? { top: 'auto', bottom: '-4px' } : { top: '-4px' })
              }}
              role="menu"
            >
              {item.submenu.map((sub, sIdx) => (
                <div key={sIdx}>
                  {sub.sepBefore && <div className="popup-sep" role="separator" />}
                  <button
                    type="button"
                    role="menuitem"
                    className={`popup-item ${sub.accent ? 'accent' : ''} ${sub.danger ? 'danger' : ''}`}
                    onClick={() => {
                      sub.onClick?.();
                      onClose();
                    }}
                  >
                    <span className="truncate">{sub.label}</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        );
      })}
    </div>
  );
}

export function LovedConfirmDialog({
  open,
  lang,
  onConfirm,
  onClose
}: {
  open: boolean;
  lang: LangCode;
  onConfirm: () => void;
  onClose: () => void;
}): JSX.Element {
  const { ref, dismiss: handleClose, dialogProps } = useModalDialog(open, onClose);

  return (
    <dialog
      ref={ref}
      className="pola-dialog small"
      aria-labelledby="loved-confirm-title"
      {...dialogProps}
    >
      <div className="dlg-form">
        <h2 id="loved-confirm-title">{t(lang, 'dlg.loved_write_title', 'LOVED')}</h2>
        <p className="dlg-sub">{t(lang, 'dlg.loved_write_body', 'LOVED')}</p>
        <div className="dlg-footer">
          <button type="button" className="action-outline-btn" onClick={handleClose}>
            {t(lang, 'btn.cancel')}
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={() => {
              onConfirm();
              handleClose();
            }}
          >
            {t(lang, 'btn.write_tags')}
          </button>
        </div>
      </div>
    </dialog>
  );
}

export function DuplicateTracksDialog({
  lang,
  prompt,
  onClose
}: {
  lang: LangCode;
  prompt: DupPromptState | null;
  onClose: () => void;
}): JSX.Element {
  const resolve = (action: 'skip' | 'keep' | 'cancel') => {
    if (ref.current) ref.current.returnValue = '';
    void rpc('playlists.dupResolve', { action });
    onClose();
  };
  const { ref, dialogProps } = useModalDialog(Boolean(prompt), () => resolve('cancel'));

  const title = prompt
    ? prompt.dupCount === 1
      ? t(lang, 'dlg.dup_one')
      : t(lang, 'dlg.dup_many', fmtNum(prompt.dupCount))
    : '';
  const extra = prompt ? Math.max(0, prompt.dupCount - prompt.rows.length) : 0;

  return (
    <dialog
      ref={ref}
      className="pola-dialog small"
      aria-labelledby="dup-dlg-title"
      {...dialogProps}
    >
      <div className="dlg-form">
        <h2 id="dup-dlg-title">{title}</h2>
        {prompt && (
          <>
            <p className="dlg-sub">{t(lang, 'dlg.dup_already_in', prompt.playlistName)}</p>
            <ul className="dup-preview-list">
              {prompt.rows.map((r, i) => (
                <li key={i} className="truncate">
                  <strong>{r.title}</strong>
                  {r.artist ? <span> — {r.artist}</span> : null}
                </li>
              ))}
            </ul>
            {extra > 0 && <div className="dlg-sub">{t(lang, 'dlg.dup_more', fmtNum(extra))}</div>}
          </>
        )}
        <div className="dlg-footer">
          <button type="button" className="action-outline-btn" onClick={() => resolve('cancel')}>
            {t(lang, 'btn.cancel')}
          </button>
          <button type="button" className="action-outline-btn" onClick={() => resolve('keep')}>
            {t(lang, 'btn.add_anyway')}
          </button>
          <button type="button" className="primary-btn" onClick={() => resolve('skip')}>
            {t(lang, 'btn.skip_duplicates')}
          </button>
        </div>
      </div>
    </dialog>
  );
}

export function ReplayGainDialog({
  lang,
  open,
  missingCount,
  totalCount,
  onConfirm,
  onClose
}: {
  lang: LangCode;
  open: boolean;
  missingCount: number;
  totalCount: number;
  onConfirm: () => void;
  onClose: () => void;
}): JSX.Element {
  const { ref, dismiss: handleClose, dialogProps } = useModalDialog(open, onClose);

  return (
    <dialog
      ref={ref}
      className="pola-dialog small"
      aria-labelledby="rg-dlg-title"
      {...dialogProps}
    >
      <div className="dlg-form">
        <h2 id="rg-dlg-title">{t(lang, 'dlg.rg_title')}</h2>
        <div className="rg-need-line">{t(lang, 'dlg.rg_need', fmtNum(missingCount), fmtNum(totalCount))}</div>
        <p className="dlg-sub">{t(lang, 'dlg.rg_body')}</p>
        <div className="dlg-footer">
          <button type="button" className="action-outline-btn" onClick={handleClose}>
            {t(lang, 'btn.cancel')}
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={() => {
              onConfirm();
              handleClose();
            }}
          >
            {t(lang, 'btn.scan_normalize')}
          </button>
        </div>
      </div>
    </dialog>
  );
}

export function OnboardingWizardDialog({
  open,
  lang,
  settings,
  navConnection,
  onClose
}: {
  open: boolean;
  lang: LangCode;
  settings: SettingsState;
  navConnection: NavConnectionState;
  onClose: () => void;
}): JSX.Element {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sources, setSources] = useState<'local' | 'both'>(settings.sources);
  const [themeMode, setThemeMode] = useState<0 | 1 | 2>(settings.themeMode);
  const [languageMode, setLanguageMode] = useState<'auto' | 'en' | 'zh-CN'>(settings.languageMode);
  const [server, setServer] = useState(settings.server);
  const [user, setUser] = useState(settings.user);
  const [password, setPassword] = useState('');
  const [importNote, setImportNote] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSkip = async () => {
    if (ref.current) ref.current.returnValue = '';
    await rpc('settings.completeOnboarding').catch(() => {});
    onClose();
  };

  const { ref, dialogProps } = useModalDialog(open, () => void handleSkip(), false);

  useEffect(() => {
    if (open) {
      setStep(1);
      setSources(settings.sources);
      setThemeMode(settings.themeMode);
      setLanguageMode(settings.languageMode);
      setServer(settings.server);
      setUser(settings.user);
      setPassword('');
      setImportNote('');
      setErrMsg('');
    }
  }, [open, settings.sources, settings.themeMode, settings.languageMode, settings.server, settings.user]);

  const handleFinish = async () => {
    setSaving(true);
    setErrMsg('');
    try {
      await rpc('settings.save', {
        themeMode,
        languageMode,
        sources,
        ...(sources === 'both' && server.trim()
          ? { connection: { server: server.trim(), user: user.trim(), password } }
          : {})
      });
      await rpc('settings.completeOnboarding');
      if (ref.current) ref.current.returnValue = '';
      setSaving(false);
      onClose();
    } catch (e: unknown) {
      setSaving(false);
      setErrMsg(e instanceof Error ? e.message : t(lang, 'setup.nav_failed'));
    }
  };

  const handleImport = async () => {
    setImportNote('');
    try {
      const res = await rpc<{ imported: number; settings: SettingsState }>('settings.importFooNavidrome');
      if (res.imported > 0 && res.settings) {
        setServer(res.settings.server || '');
        setUser(res.settings.user || '');
        setImportNote(t(lang, 'setup.imported_ok', res.imported));
      } else {
        setImportNote(t(lang, 'setup.import_none'));
      }
    } catch {
      setImportNote(t(lang, 'setup.import_none'));
    }
  };

  const titleKey = step === 1 ? 'setup.wiz_welcome' : step === 2 ? 'setup.libraries' : 'setup.appearance_title';

  return (
    <dialog
      ref={ref}
      className="pola-dialog"
      aria-labelledby="wiz-title"
      {...dialogProps}
    >
      <div className="dlg-form">
        <div className="dlg-head">
          <div className="dlg-eyebrow">{t(lang, 'setup.wiz_progress', step)}</div>
          <h2 id="wiz-title">{t(lang, titleKey)}</h2>
          {step === 1 && <p className="dlg-sub">{t(lang, 'setup.choose_source')}</p>}
        </div>

        {step === 1 && (
          <div className="source-cards">
            <button
              type="button"
              className={`source-card ${sources === 'local' ? 'active' : ''}`}
              onClick={() => setSources('local')}
            >
              <strong>{t(lang, 'source.local')}</strong>
              <span>{t(lang, 'setup.local_desc')}</span>
            </button>
            <button
              type="button"
              className={`source-card ${sources === 'both' ? 'active' : ''}`}
              onClick={() => setSources('both')}
            >
              <strong>{t(lang, 'setup.both')}</strong>
              <span>{t(lang, 'setup.both_desc')}</span>
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="dlg-section">
            <div className="srv-bar">
              <strong>{t(lang, 'source.local')}</strong>
              <button type="button" className="mini-btn" onClick={() => void rpc('settings.openPreferences')}>
                {t(lang, 'setup.preferences')}
              </button>
            </div>
            <p className="dlg-sub">{t(lang, 'setup.local_path')}</p>

            {sources === 'both' ? (
              <>
                <div className="srv-bar" style={{ marginTop: '8px' }}>
                  <strong>{t(lang, 'source.navidrome')}</strong>
                  <button type="button" className="mini-btn" onClick={() => void handleImport()}>
                    {t(lang, 'setup.import_foo_nav')}
                  </button>
                </div>
                {importNote && <div className="conn-status connected">{importNote}</div>}
                <label className="field-label">
                  <span>{t(lang, 'setup.server_url')}</span>
                  <input
                    type="url"
                    className="field-input"
                    placeholder="https://music.example.com"
                    value={server}
                    onInput={(e) => setServer((e.currentTarget as HTMLInputElement).value)}
                  />
                </label>
                <label className="field-label">
                  <span>{t(lang, 'setup.username')}</span>
                  <input
                    type="text"
                    className="field-input"
                    value={user}
                    onInput={(e) => setUser((e.currentTarget as HTMLInputElement).value)}
                  />
                </label>
                <label className="field-label">
                  <span>{t(lang, 'setup.password')}</span>
                  <input
                    type="password"
                    className="field-input"
                    placeholder={settings.configured ? t(lang, 'setup.keep_password') : ''}
                    value={password}
                    onInput={(e) => setPassword((e.currentTarget as HTMLInputElement).value)}
                  />
                </label>
                <div className="conn-row">
                  <button
                    type="button"
                    className="action-outline-btn"
                    onClick={() => void rpc('settings.testServer', { server, user, password })}
                  >
                    {t(lang, 'setup.test')}
                  </button>
                  <span className={`conn-status ${navConnection.status}`}>
                    {errMsg ||
                      (navConnection.status === 'connected'
                        ? t(lang, 'setup.nav_connected')
                        : navConnection.status === 'testing'
                          ? t(lang, 'setup.nav_testing')
                          : navConnection.status === 'failed'
                            ? navConnection.error || t(lang, 'setup.nav_failed')
                            : t(lang, 'setup.nav_idle'))}
                  </span>
                </div>
              </>
            ) : (
              <p className="dlg-sub">{t(lang, 'setup.local_later')}</p>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="dlg-section">
            <div className="seg-row">
              {([0, 1, 2] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`seg-btn ${themeMode === m ? 'active' : ''}`}
                  onClick={() => setThemeMode(m)}
                >
                  {m === 0 ? t(lang, 'setup.system') : m === 1 ? t(lang, 'setup.dark') : t(lang, 'setup.light')}
                </button>
              ))}
            </div>
            <div className="seg-row">
              {(['auto', 'en', 'zh-CN'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`seg-btn ${languageMode === l ? 'active' : ''}`}
                  onClick={() => setLanguageMode(l)}
                >
                  {l === 'auto' ? t(lang, 'setup.lang_auto') : l === 'en' ? t(lang, 'setup.lang_en') : t(lang, 'setup.lang_zh')}
                </button>
              ))}
            </div>
            {errMsg && <div className="dlg-err">{errMsg}</div>}
          </div>
        )}

        <div className="dlg-footer split">
          <button type="button" className="mini-btn" onClick={() => void handleSkip()}>
            {t(lang, 'setup.skip')}
          </button>
          <div className="dlg-footer-right">
            {step > 1 && (
              <button
                type="button"
                className="action-outline-btn"
                onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
              >
                {t(lang, 'setup.back')}
              </button>
            )}
            {step < 3 ? (
              <button
                type="button"
                className="primary-btn"
                onClick={() => setStep((s) => (s === 1 ? 2 : 3))}
              >
                {t(lang, 'setup.next')}
              </button>
            ) : (
              <button type="button" className="primary-btn" disabled={saving} onClick={() => void handleFinish()}>
                {t(lang, 'setup.start')}
              </button>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}
