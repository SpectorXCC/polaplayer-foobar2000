import { JSX } from 'preact';
import { rpc } from '../bridge/rpc';
import { t, LangCode } from '../i18n/strings';
import { Icon } from './Icons';

export interface TitlebarProps {
  lang: LangCode;
  maximized: boolean;
  isNarrowWindow: boolean;
  isCompactMenu: boolean;
  navOpen: boolean;
  onToggleNav: () => void;
  onOpenSetup: () => void;
  onOpenCompactMenu: (x: number, y: number) => void;
  onOpenSnapMenu: (x: number, y: number) => void;
}

export function Titlebar({
  lang,
  maximized,
  isNarrowWindow,
  isCompactMenu,
  navOpen,
  onToggleNav,
  onOpenSetup,
  onOpenCompactMenu,
  onOpenSnapMenu
}: TitlebarProps): JSX.Element {
  const openRootMenu = (root: 'file' | 'library' | 'help', ev: MouseEvent) => {
    const el = ev.currentTarget as HTMLElement | null;
    const rect = el?.getBoundingClientRect();
    const x = rect ? Math.round(rect.left) : Math.round(ev.clientX);
    const y = rect ? Math.round(rect.bottom + 2) : Math.round(ev.clientY);
    void rpc('chrome.openMenu', { root, x, y });
  };

  return (
    <header className="titlebar" role="banner">
      <div className="tb-left no-drag">
        {isNarrowWindow && (
          <button
            type="button"
            className="tb-icon-btn"
            aria-label={t(lang, 'nav.your_library')}
            aria-expanded={navOpen}
            aria-controls="nav-drawer"
            onClick={onToggleNav}
          >
            <Icon name="sidebar" size={16} />
          </button>
        )}

        {isCompactMenu ? (
          <button
            type="button"
            className="tb-menu-btn"
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              onOpenCompactMenu(Math.round(rect.left), Math.round(rect.bottom + 4));
            }}
          >
            <span>{t(lang, 'menu.more')}</span>
            <Icon name="chevron" size={13} />
          </button>
        ) : (
          <nav className="tb-menus" aria-label="Application menu">
            <button type="button" className="tb-menu-btn" onClick={(e) => openRootMenu('file', e)}>
              {t(lang, 'menu.file')}
            </button>
            <button type="button" className="tb-menu-btn" onClick={(e) => openRootMenu('library', e)}>
              {t(lang, 'menu.library')}
            </button>
            <button type="button" className="tb-menu-btn" onClick={onOpenSetup}>
              {t(lang, 'menu.settings')}
            </button>
            <button type="button" className="tb-menu-btn" onClick={(e) => openRootMenu('help', e)}>
              {t(lang, 'menu.help')}
            </button>
          </nav>
        )}
      </div>

      <div
        className="tb-drag"
        onDblClick={() => void rpc('chrome.toggleMaximize')}
        onContextMenu={(e) => {
          e.preventDefault();
          void rpc('chrome.showSystemMenu');
        }}
      />

      <div className="tb-caps no-drag">
        <button
          type="button"
          className="tb-cap-btn"
          aria-label="Minimize"
          onClick={() => void rpc('chrome.minimize')}
        >
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
            <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" stroke-width="1" />
          </svg>
        </button>

        <button
          type="button"
          className="tb-cap-btn"
          aria-label={maximized ? 'Restore' : 'Maximize'}
          onClick={() => void rpc('chrome.toggleMaximize')}
          onContextMenu={(e) => {
            e.preventDefault();
            onOpenSnapMenu(Math.round(e.clientX), Math.round(e.clientY));
          }}
        >
          {maximized ? (
            <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" fill="none">
              <polyline points="2.5,2.5 2.5,0.5 9.5,0.5 9.5,7.5 7.5,7.5" stroke="currentColor" stroke-width="1" />
              <rect x="0.5" y="2.5" width="7" height="7" stroke="currentColor" stroke-width="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" fill="none">
              <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" stroke-width="1" />
            </svg>
          )}
        </button>

        <button
          type="button"
          className="tb-cap-btn close"
          aria-label="Close"
          onClick={() => void rpc('chrome.close')}
        >
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
            <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.15" />
            <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.15" />
          </svg>
        </button>
      </div>
    </header>
  );
}
