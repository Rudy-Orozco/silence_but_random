'use strict';

const $ = (id) => document.getElementById(id);
const UNIT_MS = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000 };

let data; // { folders, clips, settings } — persisted by main
let audioUrl;
let session = null; // { startedAt, endAt, nextAt, playing, lastId, timer }
let note = ''; // shown when idle, e.g. "Session finished"
let previewId = null;
let saveTimer = null;
let toastTimer = null;
const collapsed = new Set();

const player = new Audio(); // session playback
const preview = new Audio(); // per-clip preview button

// ---------- helpers ----------

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clipUrl = (clip) => audioUrl + encodeURIComponent(clip.file);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function fmt(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2500);
}

function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  api.save(data);
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
}
window.addEventListener('beforeunload', () => {
  if (saveTimer) flush();
});

function enabledClips() {
  const on = new Set(data.folders.filter((f) => f.enabled).map((f) => f.id));
  return data.clips.filter((c) => c.enabled && on.has(c.folderId));
}

// ---------- library ----------

function renderFolders() {
  $('folders').innerHTML = data.folders
    .map((f) => {
      const clips = data.clips.filter((c) => c.folderId === f.id);
      const open = !collapsed.has(f.id);
      const rows = clips.length
        ? clips
            .map(
              (c) => `<div class="clip ${c.enabled ? '' : 'off'}" data-clip="${c.id}">
                <input type="checkbox" data-act="toggleClip" title="Include this sound" ${c.enabled ? 'checked' : ''} />
                <span class="name" title="${esc(c.name)}">${esc(c.name)}</span>
                <button class="icon" data-act="preview" title="Preview">${previewId === c.id ? '■' : '▶'}</button>
                <button class="icon danger" data-act="delClip" title="Remove">✕</button>
              </div>`
            )
            .join('')
        : `<div class="empty">No sounds yet. Click “Add sounds” or drop audio files here.</div>`;
      return `<div class="folder ${f.enabled ? '' : 'off'}" data-folder="${f.id}">
        <div class="folder-head">
          <button class="icon" data-act="collapse" title="Show/hide sounds">${open ? '▾' : '▸'}</button>
          <input type="checkbox" data-act="toggleFolder" title="Include this folder in sessions" ${f.enabled ? 'checked' : ''} />
          <input class="name-input" data-act="rename" value="${esc(f.name)}" aria-label="Folder name" />
          <span class="count">${clips.filter((c) => c.enabled).length}/${clips.length}</span>
          <button data-act="add">+ Add sounds</button>
          <button class="icon danger" data-act="delFolder" title="Delete folder">🗑</button>
        </div>
        ${open ? `<div class="clips">${rows}</div>` : ''}
      </div>`;
    })
    .join('');
}

function renderAll() {
  renderFolders();
  renderStatus();
}

function addClips(folderId, files) {
  for (const f of files) {
    data.clips.push({ id: crypto.randomUUID(), folderId, name: f.name, file: f.file, enabled: true });
  }
  collapsed.delete(folderId);
  save();
  renderAll();
  toast(files.length ? `Added ${plural(files.length, 'sound')}` : 'No supported audio files found');
}

function stopPreview() {
  preview.pause();
  if (previewId !== null) {
    previewId = null;
    renderFolders();
  }
}
preview.addEventListener('ended', stopPreview);
preview.addEventListener('error', () => {
  if (previewId !== null) toast('That file could not be played');
  stopPreview();
});

function togglePreview(id) {
  if (previewId === id) return stopPreview();
  const clip = data.clips.find((c) => c.id === id);
  if (!clip) return;
  preview.src = clipUrl(clip);
  preview.volume = data.settings.volume / 100;
  previewId = id;
  preview.play().catch(() => {});
  renderFolders();
}

async function removeClip(id) {
  const clip = data.clips.find((c) => c.id === id);
  if (!clip) return;
  if (previewId === id) stopPreview();
  data.clips = data.clips.filter((c) => c.id !== id);
  api.removeFile(clip.file);
  save();
  renderAll();
}

const folderOf = (el) => el.closest('.folder')?.dataset.folder;

$('folders').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const folderId = folderOf(btn);
  const clipId = btn.closest('.clip')?.dataset.clip;
  switch (btn.dataset.act) {
    case 'collapse':
      collapsed.has(folderId) ? collapsed.delete(folderId) : collapsed.add(folderId);
      return renderFolders();
    case 'add':
      return addClips(folderId, await api.pickFiles());
    case 'preview':
      return togglePreview(clipId);
    case 'delClip':
      return removeClip(clipId);
    case 'delFolder': {
      const folder = data.folders.find((f) => f.id === folderId);
      const count = data.clips.filter((c) => c.folderId === folderId).length;
      const detail = count ? ` and its ${plural(count, 'sound')}` : '';
      if (!confirm(`Delete “${folder.name}”${detail}?`)) return;
      for (const c of data.clips.filter((c) => c.folderId === folderId)) {
        if (previewId === c.id) stopPreview();
        api.removeFile(c.file);
      }
      data.clips = data.clips.filter((c) => c.folderId !== folderId);
      data.folders = data.folders.filter((f) => f.id !== folderId);
      save();
      return renderAll();
    }
  }
});

$('folders').addEventListener('change', (e) => {
  const act = e.target.dataset.act;
  if (act === 'toggleFolder') {
    data.folders.find((f) => f.id === folderOf(e.target)).enabled = e.target.checked;
  } else if (act === 'toggleClip') {
    data.clips.find((c) => c.id === e.target.closest('.clip').dataset.clip).enabled = e.target.checked;
  } else return;
  save();
  renderAll();
});

$('folders').addEventListener('input', (e) => {
  if (e.target.dataset.act !== 'rename') return;
  data.folders.find((f) => f.id === folderOf(e.target)).name = e.target.value;
  save();
});

$('newFolder').addEventListener('click', () => {
  const id = crypto.randomUUID();
  data.folders.push({ id, name: 'New folder', enabled: true });
  save();
  renderFolders();
  const input = document.querySelector(`[data-folder="${id}"] .name-input`);
  input.focus();
  input.select();
});

$('importFolder').addEventListener('click', async () => {
  const result = await api.pickFolder();
  if (!result) return;
  if (!result.files.length) return toast('No supported audio files in that folder');
  const id = crypto.randomUUID();
  data.folders.push({ id, name: result.name, enabled: true });
  addClips(id, result.files);
});

// Drag & drop audio files onto a folder.
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.querySelectorAll('.folder.drag').forEach((el) => el.classList.remove('drag'));
  e.target.closest?.('.folder')?.classList.add('drag');
});
document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) document.querySelectorAll('.folder.drag').forEach((el) => el.classList.remove('drag'));
});
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  document.querySelectorAll('.folder.drag').forEach((el) => el.classList.remove('drag'));
  const folderId = e.target.closest?.('.folder')?.dataset.folder;
  if (!folderId) return toast('Drop files onto a folder to add them');
  const paths = [...e.dataTransfer.files].map((f) => api.pathFor(f));
  addClips(folderId, await api.importPaths(paths));
});

// ---------- settings ----------

function syncSettings() {
  const s = data.settings;
  for (const key of Object.keys(s)) {
    const el = $(key);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = s[key];
    else el.value = s[key];
  }
  $('volumeLabel').textContent = `${s.volume}%`;
  const locked = !!session;
  $('durationValue').disabled = locked || s.unlimited;
  $('durationUnit').disabled = locked || s.unlimited;
  $('unlimited').disabled = locked;
}

function onSettingChange(e) {
  const el = e.target;
  const s = data.settings;
  if (!(el.id in s)) return;
  if (el.type === 'number' && e.type === 'input') return; // wait until the field is committed
  let value;
  if (el.type === 'checkbox') value = el.checked;
  else if (el.type === 'number' || el.type === 'range') {
    value = Number(el.value);
    if (!Number.isFinite(value) || (el.type === 'number' && value <= 0)) return syncSettings();
  } else value = el.value;

  s[el.id] = value;
  if (s.intervalMin > s.intervalMax) [s.intervalMin, s.intervalMax] = [s.intervalMax, s.intervalMin];
  save();
  syncSettings();

  if (el.id === 'volume') {
    player.volume = value / 100;
    preview.volume = value / 100;
  }
  if (el.id === 'keepAwake' && session) api.keepAwake(value);
  renderStatus();
}
$('settings').addEventListener('input', onSettingChange);
$('settings').addEventListener('change', onSettingChange);

// ---------- session ----------

function randomDelay() {
  const s = data.settings;
  const lo = s.intervalMin * UNIT_MS[s.intervalUnit];
  const hi = s.intervalMax * UNIT_MS[s.intervalUnit];
  return Math.max(1000, lo + Math.random() * (hi - lo));
}

function startSession() {
  if (session || !enabledClips().length) return;
  const s = data.settings;
  const now = Date.now();
  player.pause();
  note = '';
  session = {
    startedAt: now,
    endAt: s.unlimited ? null : now + s.durationValue * UNIT_MS[s.durationUnit],
    nextAt: now + randomDelay(),
    playing: null,
    lastId: null,
    timer: setInterval(tick, 250),
  };
  api.keepAwake(s.keepAwake);
  syncSettings();
  renderStatus();
}

// Ends the session. A clip that is mid-play is only cut off when the user stops manually.
function endSession(reason) {
  clearInterval(session.timer);
  session = null;
  api.keepAwake(false);
  if (reason === 'stop') player.pause();
  note = { stop: 'Session stopped.', done: 'Session finished.', empty: 'Session stopped: no sounds are enabled.' }[reason];
  syncSettings();
  renderStatus();
}

function tick() {
  const now = Date.now();
  if (session.endAt && now >= session.endAt) return endSession('done');
  if (!session.playing && now >= session.nextAt) playNext();
  renderStatus();
}

function playNext() {
  let pool = enabledClips();
  if (!pool.length) return endSession('empty');
  if (data.settings.avoidRepeat && pool.length > 1) pool = pool.filter((c) => c.id !== session.lastId);
  const clip = pool[Math.floor(Math.random() * pool.length)];
  session.playing = clip;
  session.lastId = clip.id;
  player.src = clipUrl(clip);
  player.volume = data.settings.volume / 100;
  player.play().catch(finishClip);
}

// The wait for the next sound starts when the current one ends, so gaps are real silence.
function finishClip() {
  if (!session || !session.playing) return;
  session.playing = null;
  session.nextAt = Date.now() + randomDelay();
}
player.addEventListener('ended', finishClip);
player.addEventListener('error', finishClip);

function renderStatus() {
  const btn = $('toggle');
  const progress = $('progress');
  if (!session) {
    const n = enabledClips().length;
    btn.textContent = 'Start session';
    btn.classList.remove('stop');
    btn.disabled = n === 0;
    progress.hidden = true;
    $('status').textContent = n
      ? `${note ? note + ' ' : ''}${plural(n, 'sound')} ready.`
      : 'Turn on at least one sound to begin.';
    return;
  }
  const now = Date.now();
  btn.textContent = 'Stop';
  btn.classList.add('stop');
  btn.disabled = false;

  const parts = [session.playing ? `Playing “${session.playing.name}”` : 'Silence…'];
  if (!session.playing && data.settings.showNext) parts.push(`next sound in ${fmt(session.nextAt - now)}`);
  if (session.endAt) parts.push(`${fmt(session.endAt - now)} left`);
  $('status').textContent = parts.join(' · ');

  progress.hidden = !session.endAt;
  if (session.endAt) {
    const pct = ((now - session.startedAt) / (session.endAt - session.startedAt)) * 100;
    $('progressBar').style.width = `${Math.min(100, pct)}%`;
  }
}

$('toggle').addEventListener('click', () => (session ? endSession('stop') : startSession()));

// ---------- init ----------

(async () => {
  ({ data, audioUrl } = await api.load());
  syncSettings();
  renderAll();
})();
