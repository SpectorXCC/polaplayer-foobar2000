import './preview.css';
import { PlaybackClock } from './playback_clock';

type Send = (message: Record<string, unknown>) => void;
interface Track { key: number; title: string; artist: string; coverUrl: string }
interface Song { index: number; title: string; artist: string; album: string; duration: number; kind?: string }
interface Playlist { id: string; name: string }
type View = 'playlist' | 'search' | 'queue';
type Edit = 'create' | 'rename' | 'delete' | 'add' | 'remove';
interface Settings {
  type: 'preview-settings'; language: string; languageMode: string; theme: number; light: boolean; sources: string;
}
export type PreviewMessage =
  | { type: 'preview-open'; language: string }
  | { type: 'preview-list'; revision: number; source: string; selected: string | null;
      status: 'loading' | 'ready' | 'error'; title: string; count: number; playlists: Playlist[];
      mode: View; query: string; editable: boolean }
  | { type: 'preview-page'; revision: number; index: number; rows: Song[] }
  | Settings
  | { type: 'preview-result'; ok: boolean; reason: string }
  | { type: 'preview-connection'; status: 'connected'|'failed'|'unconfigured'|'testing' }
  | { type: 'preview-space'|'preview-escape' }
  | { type: 'preview-playback'; playback: { playing: boolean; paused: boolean; time: number; length: number }; track?: Track; seek?: boolean };

const labels = {
  en: {
    close: 'Back to classic UI', local: 'Local music', playlist: 'Playlist',
    title: 'Title', album: 'Album', loading: 'Loading songs…', empty: 'No songs in this view',
    error: 'Could not load the playlist', track: 'Nothing playing',
    prev: 'Previous', play: 'Play', pause: 'Pause', next: 'Next', progress: 'Playback position',
    fullscreen: 'Full-screen lyrics', count: (n: number) => `${n.toLocaleString()} songs`,
    browse:'Songs', queue:'Queue', search:'Search songs, artists or albums', settings:'Settings',
    create:'New playlist', rename:'Rename', delete:'Delete playlist', add:'Add to playlist',
    remove:'Remove song', removeQueue:'Remove from queue', enqueue:'Add to queue',
    cancel:'Cancel', save:'Save', confirm:'Confirm', name:'Playlist name',
    theme:'Appearance', language:'Language', sources:'Music sources', auto:'System default',
    dark:'Dark', light:'Light', both:'Local music and Navidrome', prefs:'foobar2000 preferences',
    test:'Test Navidrome', ok:'Done', operationFailed:'The operation could not be completed',
    duplicate:'This song is already in the playlist', locked:'This playlist cannot be edited',
    'empty-name':'Enter a name', busy:'Another playlist change is in progress',
    stale:'The list changed. Select the item again.', submitted:'Queue request sent',
    connected:'Connected', failed:'Connection failed', unconfigured:'Configure a server in foobar2000 preferences',
    testing:'Testing connection…'
  },
  zh: {
    close: '返回原界面', local: '本地音乐', playlist: '歌单',
    title: '歌曲', album: '专辑', loading: '正在加载歌曲…', empty: '这里还没有歌曲',
    error: '加载歌单失败', track: '暂无播放曲目',
    prev: '上一首', play: '播放', pause: '暂停', next: '下一首', progress: '播放进度',
    fullscreen: '全屏歌词', count: (n: number) => `${n.toLocaleString()} 首歌曲`,
    browse:'歌曲', queue:'播放队列', search:'搜索歌曲、歌手或专辑', settings:'设置',
    create:'新建歌单', rename:'重命名', delete:'删除歌单', add:'加入歌单',
    remove:'移出歌曲', removeQueue:'移出队列', enqueue:'加入队列',
    cancel:'取消', save:'保存', confirm:'确认', name:'歌单名称',
    theme:'外观', language:'语言', sources:'音乐来源', auto:'跟随系统',
    dark:'深色', light:'浅色', both:'本地音乐和 Navidrome', prefs:'foobar2000 首选项',
    test:'测试 Navidrome', ok:'已完成', operationFailed:'操作未能完成',
    duplicate:'歌曲已在此歌单中', locked:'此歌单无法编辑',
    'empty-name':'请输入歌单名称', busy:'正在处理另一项歌单修改',
    stale:'列表已更新，请重新选择', submitted:'已提交加入队列的请求',
    connected:'已连接', failed:'连接失败', unconfigured:'请在 foobar2000 首选项配置服务器',
    testing:'正在测试连接…'
  }
};

const ROW_HEIGHT = 54;
const PAGE_SIZE = 100;
const MAX_CACHED_PAGES = 8;

export function createPreview(send: Send, timeText: (sec: number) => string, icons: {
  prev: string; play: string; pause: string; next: string
}) {
  const node = <T extends HTMLElement = HTMLElement>(name: string) => document.getElementById(name)! as T;
  const root = node('web-preview');
  const scroll = node('preview-scroll');
  const rows = node('preview-rows');
  const playlist = node<HTMLSelectElement>('preview-playlist');
  const seek = node<HTMLInputElement>('preview-position');
  const cover = node<HTMLImageElement>('preview-cover');
  const play = node<HTMLButtonElement>('preview-play');
  const search = node<HTMLInputElement>('preview-search');
  const editDialog = node<HTMLDialogElement>('preview-edit-dialog');
  const editName = node<HTMLInputElement>('preview-edit-name');
  const settingsDialog = node<HTMLDialogElement>('preview-settings-dialog');
  const theme = node<HTMLSelectElement>('preview-theme');
  const language = node<HTMLSelectElement>('preview-language');
  const sources = node<HTMLSelectElement>('preview-source-mode');
  root.style.setProperty('--preview-row-height', `${ROW_HEIGHT}px`);
  const clock = new PlaybackClock();
  let text = labels.en;
  let visible = false;
  let revision = -1;
  let count = 0;
  let playing = false;
  let duration = 0;
  let track: Track | undefined;
  let frame = 0;
  let seekDraft = false;
  let seekTrack: number | undefined;
  let lastRange = '';
  let mode: View = 'playlist';
  let editable = false;
  let selected: Song | undefined;
  let searchTimer = 0;
  let prefs: Settings | undefined;
  let draft: { action: Edit; revision: number; index?: number } | undefined;
  const pages = new Map<number, Map<number, Song>>();
  const pending = new Set<number>();

  function paintRows(force = false) {
    if (!visible) return;
    const first = Math.max(0, Math.floor(scroll.scrollTop / ROW_HEIGHT) - 6);
    const last = Math.min(count, Math.ceil((scroll.scrollTop + scroll.clientHeight) / ROW_HEIGHT) + 6);
    const range = `${first}:${last}`;
    if (!force && range === lastRange) return;
    lastRange = range;
    const fragment = document.createDocumentFragment();
    for (let index = first; index < last; index++) {
      const start = Math.floor(index / PAGE_SIZE) * PAGE_SIZE;
      const page = pages.get(start);
      if (!page && !pending.has(start)) {
        pending.add(start);
        send({ type: 'preview-page', revision, index: start });
      }
      const song = page?.get(index);
      if (!song) continue;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'preview-row';
      row.dataset.index = String(index);
      if (selected?.index === index) row.classList.add('selected');
      row.style.top = `${index * ROW_HEIGHT}px`;
      const title = document.createElement('span');
      const name = document.createElement('strong');
      const artist = document.createElement('small');
      name.textContent = song.title;
      artist.textContent = song.artist;
      title.append(name, artist);
      const number = document.createElement('span');
      const album = document.createElement('span');
      const length = document.createElement('span');
      number.textContent = String(index + 1);
      album.textContent = song.album;
      length.textContent = song.duration ? timeText(song.duration) : '';
      row.append(number, title, album, length);
      fragment.append(row);
    }
    rows.replaceChildren(fragment);
  }

  function paintPlayback(now: number) {
    frame = 0;
    if (!visible) return;
    const time = seekDraft ? Number(seek.value) : clock.at(now) / 1000;
    if (!seekDraft) seek.value = String(time);
    node('preview-time').textContent = timeText(time);
    if (playing || seekDraft) frame = requestAnimationFrame(paintPlayback);
  }

  function repaintPlayback() {
    cancelAnimationFrame(frame);
    paintPlayback(performance.now());
  }

  function setTrack(next?: Track) {
    if (next?.key !== track?.key) seekDraft = false;
    track = next;
    node('preview-now-title').textContent = track?.title || text.track;
    node('preview-artist').textContent = track?.artist || '';
    const url = track?.coverUrl || '';
    if (url && cover.getAttribute('src') !== url) cover.src = url;
    if (!url) cover.removeAttribute('src');
    cover.classList.toggle('hidden', !url);
  }

  function close() {
    visible = false;
    root.classList.add('hidden');
    pending.clear();
    seekDraft = false;
    clearTimeout(searchTimer);
    searchTimer = 0;
    editDialog.close();
    settingsDialog.close();
    cancelAnimationFrame(frame);
    frame = 0;
  }

  function translate(lang: string) {
      text = lang === 'zh-CN' ? labels.zh : labels.en;
      node('preview-close').textContent = text.close;
      node('preview-local').textContent = text.local;
      node('preview-playlist-label').textContent = text.playlist;
      node('preview-title-label').textContent = text.title;
      node('preview-album-label').textContent = text.album;
      node('preview-fullscreen').textContent = text.fullscreen;
      node('preview-prev').setAttribute('aria-label', text.prev);
      node('preview-next').setAttribute('aria-label', text.next);
      seek.setAttribute('aria-label', text.progress);
      search.placeholder = text.search;
      search.setAttribute('aria-label', text.search);
      editName.setAttribute('aria-label', text.name);
      const strings = {
        browse:text.browse, queue:text.queue, 'settings-open':text.settings, 'settings-title':text.settings,
        create:text.create, rename:text.rename, delete:text.delete, add:text.add, enqueue:text.enqueue,
        'theme-label':text.theme, 'language-label':text.language, 'sources-label':text.sources,
        prefs:text.prefs, 'test-server':text.test, 'edit-cancel':text.cancel,
        'settings-cancel':text.cancel, 'settings-save':text.save
      };
      for (const [id,value] of Object.entries(strings)) node(`preview-${id}`).textContent = value;
      updateActions();
  }

  function updateActions() {
    const hasPlaylist = playlist.value !== '';
    const editButtons = {
      create: mode === 'playlist', rename: mode === 'playlist' && editable,
      delete: mode === 'playlist' && editable,
      add: mode === 'search' && hasPlaylist && editable,
      enqueue: mode !== 'queue',
      remove: mode === 'playlist' && editable || mode === 'queue' && selected?.kind === 'manual'
    };
    for (const [id,show] of Object.entries(editButtons)) {
      const button = node<HTMLButtonElement>(`preview-${id}`);
      button.hidden = !show;
      button.disabled = ['add','enqueue','remove'].includes(id) && !selected;
    }
    node('preview-remove').textContent = mode === 'queue' ? text.removeQueue : text.remove;
  }

  function fillSettings() {
    if (!prefs) return;
    theme.replaceChildren(new Option(text.auto,'0'), new Option(text.dark,'1'), new Option(text.light,'2'));
    language.replaceChildren(new Option(text.auto,'auto'), new Option('简体中文','zh-CN'), new Option('English','en'));
    sources.replaceChildren(new Option(text.local,'local'), new Option(text.both,'both'));
    theme.value = String(prefs.theme);
    language.value = prefs.languageMode;
    sources.value = prefs.sources;
  }

  function message(msg: PreviewMessage) {
    if (msg.type === 'preview-open') {
      translate(msg.language);
      visible = true;
      root.classList.remove('hidden');
    } else if (msg.type === 'preview-list') {
      mode = msg.mode || 'playlist';
      editable = !!msg.editable;
      node('preview-browse').setAttribute('aria-pressed', String(mode==='playlist'));
      node('preview-queue').setAttribute('aria-pressed', String(mode==='queue'));
      if (document.activeElement !== search && !searchTimer) search.value = msg.query || '';
      node('preview-title').textContent = msg.title;
      node('preview-status').textContent = msg.status === 'loading' ? text.loading :
        msg.status === 'error' ? text.error : msg.count ? text.count(msg.count) : text.empty;
      for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-source]')) {
        button.setAttribute('aria-pressed', String(button.dataset.source === msg.source));
      }
      playlist.replaceChildren(...msg.playlists.map(p => new Option(p.name, p.id)));
      playlist.disabled = !msg.playlists.length;
      if (msg.selected !== null) playlist.value = msg.selected;
      if (msg.revision !== revision) {
        revision = msg.revision;
        pages.clear();
        pending.clear();
        scroll.scrollTop = 0;
        selected = undefined;
      }
      count = msg.count;
      rows.style.height = `${count * ROW_HEIGHT}px`;
      paintRows(true);
      updateActions();
    } else if (msg.type === 'preview-settings') {
      const changed = prefs?.language !== msg.language;
      prefs = msg;
      root.dataset.theme = msg.light ? 'light' : 'dark';
      node('preview-remote').hidden = msg.sources !== 'both';
      if (changed) translate(msg.language);
    } else if (msg.type === 'preview-result') {
      const reasons: Record<string, string> = {duplicate:text.duplicate, locked:text.locked, 'empty-name':text['empty-name'], busy:text.busy, stale:text.stale};
      node('preview-result').textContent = msg.ok ? msg.reason==='submitted' ? text.submitted : text.ok : reasons[msg.reason] || text.operationFailed;
    } else if (msg.type === 'preview-connection') {
      node('preview-connection').textContent = text[msg.status];
    } else if (msg.type === 'preview-space') {
      const target = document.activeElement;
      if (target instanceof HTMLInputElement && ['search','text'].includes(target.type)) {
        target.setRangeText(' ',target.selectionStart ?? target.value.length,target.selectionEnd ?? target.value.length,'end');
        target.dispatchEvent(new Event('input'));
      } else if (target instanceof HTMLButtonElement && !target.disabled) target.click();
      else if (!settingsDialog.open && !editDialog.open) send({type:'ctrl',act:'play'});
    } else if (msg.type === 'preview-escape') {
      if (editDialog.open) editDialog.close();
      else if (settingsDialog.open) settingsDialog.close();
      else send({type:'preview-close'});
    } else if (msg.type === 'preview-page') {
      if (msg.revision !== revision) return;
      pending.delete(msg.index);
      pages.set(msg.index, new Map(msg.rows.map(song => [song.index, song])));
      if (pages.size > MAX_CACHED_PAGES) {
        const viewPage = scroll.scrollTop / ROW_HEIGHT;
        const furthest = [...pages.keys()].reduce((a,b) => Math.abs(a-viewPage)>Math.abs(b-viewPage)?a:b);
        pages.delete(furthest);
      }
      paintRows(true);
    } else if (msg.type === 'preview-playback') {
      const now = performance.now();
      const snap = msg.playback;
      const reset = msg.seek || (msg.track && msg.track.key !== track?.key) || Math.abs(clock.at(now) / 1000 - snap.time) > 1.6;
      if (msg.track) setTrack(msg.track);
      duration = snap.length;
      const active = snap.playing && !snap.paused;
      clock.sync(snap.time, duration, active, !!reset, now);
      if (playing !== active || !play.innerHTML) play.innerHTML = active ? icons.pause : icons.play;
      playing = active;
      play.setAttribute('aria-label', playing ? text.pause : text.play);
      seek.max = String(duration || 1);
      seek.disabled = duration <= 0;
      node('preview-duration').textContent = timeText(duration);
      repaintPlayback();
    }
  }

  node('preview-prev').innerHTML = icons.prev;
  node('preview-next').innerHTML = icons.next;
  for (const act of ['prev','play','next']) node(`preview-${act}`).onclick = () => send({ type:'ctrl', act });
  node('preview-close').onclick = () => send({ type:'preview-close' });
  node('preview-fullscreen').onclick = () => send({ type:'preview-fullscreen' });
  function switchView(mode: View) {
    clearTimeout(searchTimer);
    searchTimer = 0;
    node('preview-result').textContent = '';
    send({type:'preview-view',mode});
  }
  node('preview-browse').onclick = () => switchView('playlist');
  node('preview-queue').onclick = () => switchView('queue');
  search.oninput = () => {
    clearTimeout(searchTimer);
    selected = undefined;
    updateActions();
    searchTimer = window.setTimeout(() => {
      searchTimer = 0;
      send({type:'preview-search',query:search.value});
    },200);
  };
  node('preview-settings-open').onclick = () => {
    fillSettings();
    node('preview-connection').textContent = '';
    settingsDialog.showModal();
  };
  node('preview-settings-cancel').onclick = () => settingsDialog.close();
  node('preview-prefs').onclick = () => send({type:'preview-prefs'});
  node('preview-test-server').onclick = () => send({type:'preview-test-server'});
  node<HTMLFormElement>('preview-settings-form').onsubmit = event => {
    event.preventDefault();
    send({type:'preview-config',theme:Number(theme.value),language:language.value,sources:sources.value});
    settingsDialog.close();
  };
  function edit(action: Edit) {
    draft = {action,revision,index:selected?.index};
    const needsName = action==='create' || action==='rename';
    editName.hidden = !needsName;
    editName.required = needsName;
    editName.value = action==='rename' ? playlist.selectedOptions[0]?.text || '' : '';
    node('preview-edit-title').textContent = text[action];
    node('preview-edit-detail').textContent = action==='delete' ? playlist.selectedOptions[0]?.text || '' :
      action==='remove' ? selected?.title || '' : '';
    node('preview-edit-submit').textContent = needsName ? text.save : text.confirm;
    editDialog.showModal();
    if (needsName) { editName.focus(); editName.select(); }
    else node('preview-edit-cancel').focus();
  }
  for (const action of ['create','rename','delete'] as const) node(`preview-${action}`).onclick = () => edit(action);
  node('preview-edit-cancel').onclick = () => editDialog.close();
  node<HTMLFormElement>('preview-edit-form').onsubmit = event => {
    event.preventDefault();
    if (draft) send({type:'preview-edit', ...draft, name:editName.value});
    editDialog.close();
  };
  node('preview-enqueue').onclick = () => selected && send({type:'preview-enqueue',revision,index:selected.index});
  node('preview-add').onclick = () => selected && send({type:'preview-edit',action:'add',revision,index:selected.index});
  node('preview-remove').onclick = () => {
    if (!selected) return;
    if (mode==='queue') send({type:'preview-remove-queue',revision,index:selected.index});
    else edit('remove');
  };
  for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-source]')) {
    button.onclick = () => {
      clearTimeout(searchTimer);
      searchTimer = 0;
      send({ type:'preview-source', source:button.dataset.source });
    };
  }
  playlist.onchange = () => send({ type:'preview-playlist', id:playlist.value });
  const playRow = (event: Event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('.preview-row');
    if (row && !searchTimer) send({ type:'preview-play', revision, index:Number(row.dataset.index) });
  };
  rows.addEventListener('click', event => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('.preview-row');
    if (!row || searchTimer) return;
    const index = Number(row.dataset.index);
    selected = pages.get(Math.floor(index/PAGE_SIZE)*PAGE_SIZE)?.get(index);
    rows.querySelector('.selected')?.classList.remove('selected');
    row.classList.add('selected');
    updateActions();
  });
  rows.addEventListener('dblclick', playRow);
  rows.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.repeat) {
      event.preventDefault();
      playRow(event);
    }
  });
  scroll.addEventListener('scroll', () => paintRows(), { passive:true });
  new ResizeObserver(() => paintRows()).observe(scroll);
  seek.addEventListener('input', () => {
    if (!seekDraft) seekTrack = track?.key;
    seekDraft = true;
    repaintPlayback();
  });
  seek.addEventListener('change', () => {
    if (seekDraft && seekTrack === track?.key) {
      send({ type:'preview-seek', key:track?.key, time:Number(seek.value) });
    }
    seekDraft = false;
  });
  seek.addEventListener('pointercancel', () => { seekDraft = false; repaintPlayback(); });
  cover.addEventListener('error', () => cover.classList.add('hidden'));
  return { message, close };
}
