// Dialog "Geräte verbinden": QR-Code/Link anzeigen, Code eingeben, trennen.
import { syncAvailable, syncCode, lastSync, newCode, normalizeCode, syncLink, enableSync, disableSync, qrSvg, syncNow } from '../sync.js';
import { icon } from '../icons.js';
import { escapeHtml, timeAgo } from '../util.js';
import { $, openDialog, closeDialog, toast } from './dom.js';
import { shareLink } from '../share.js';
import { emit } from '../state.js';
import { deleteServerData, isShared } from '../community.js';
import { t } from '../i18n.js';

// Datei-Backup (früher eigene Menüpunkte) — gibt's in jedem Zustand des Dialogs.
const BACKUP = `<div class="backup-box">
    <h3 class="pd-h">${icon('download', { size: 16 })}${t('Datei-Backup')} <span class="pd-h-meta">${t('ohne Internet')}</span></h3>
    <div class="row-btns">
      <button class="btn btn-soft" data-backup="export">${icon('download', { size: 16 })}${t('Exportieren')}</button>
      <button class="btn btn-soft" data-backup="import">${icon('upload', { size: 16 })}${t('Importieren')}</button>
    </div>
  </div>`;
function wireBackup() {
  document.querySelectorAll('#syncBody [data-backup]').forEach(b => b.onclick = () => emit(b.dataset.backup === 'export' ? 'backup-export' : 'backup-import'));
}

// Datenschutz: alles löschen (Server + dieses Gerät). Eingeklappt, damit's nicht stört.
const WIPE = `<details class="wipe-box">
    <summary>${icon('trash', { size: 15 })}${t('Meine Daten löschen')}</summary>
    <p class="fine">${t('Löscht deine gemeldeten Preise, Bewertungen, Preisalarme, Gruppen-Mitgliedschaften und den Geräte-Sync am Server sowie Favoriten, Tagebuch, Touren und Einstellungen auf diesem Gerät. Das lässt sich nicht rückgängig machen. Andere verbundene Geräte vorher trennen, sonst laden sie ihre Daten wieder hoch.')}</p>
    <button class="btn btn-soft danger-btn" id="wipeBtn">${icon('trash', { size: 16 })}${t('Alles unwiderruflich löschen')}</button>
  </details>`;

async function wipeAll() {
  if (!confirm(t('Wirklich alle deine Bier-Locator-Daten löschen — am Server und auf diesem Gerät?'))) return;
  const btn = $('#wipeBtn');
  btn.disabled = true;
  try {
    if (isShared()) await deleteServerData(syncCode());
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      const sub = reg && await reg.pushManager?.getSubscription();
      if (sub) await sub.unsubscribe();
    } catch (e) { /* kein Push */ }
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('bl_') || k.startsWith('bierlocator'))) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
    toast(t('Alle Daten gelöscht — lädt neu…'), { tone: 'good' });
    setTimeout(() => location.reload(), 1200);
  } catch (e) {
    btn.disabled = false;
    toast(t('Löschen fehlgeschlagen: {msg}', { msg: e.message }), { tone: 'bad', ms: 5000 });
  }
}

export async function openSync() {
  const dlg = $('#syncDialog');
  await render();
  openDialog(dlg);
}

async function render() {
  await renderInner();
  $('#syncBody').insertAdjacentHTML('beforeend', BACKUP + WIPE);
  wireBackup();
  $('#wipeBtn').onclick = wipeAll;
}

async function renderInner() {
  const body = $('#syncBody');
  if (!syncAvailable()) {
    body.innerHTML = `<h2 class="dlg-title">${icon('refresh', { size: 22 })}${t('Geräte &amp; Backup')}</h2>
      <p class="fine">${t('Für den Geräte-Sync muss Supabase eingerichtet sein (siehe README).')}</p>`;
    return;
  }
  const code = syncCode();
  if (!code) {
    body.innerHTML = `
      <h2 class="dlg-title" id="syncTitle">${icon('refresh', { size: 22 })}${t('Geräte &amp; Backup')}</h2>
      <p>${t('Favoriten, Vorlieben, Promille-Log, Tagebuch und Preisalarme auf allen deinen Geräten gleich — ohne Konto.')}</p>
      <div class="sync-choice">
        <button class="btn btn-primary btn-big" id="syncStart">${icon('plus', { size: 18 })}${t('Sync starten')}</button>
        <p class="fine center">${t('Danach zeigt dieses Gerät einen QR-Code, den du mit dem anderen Handy scannst.')}</p>
      </div>
      <div class="sync-or"><span>${t('oder Code vom anderen Gerät eingeben')}</span></div>
      <form class="sync-join" id="syncJoin">
        <input id="syncCodeInput" type="text" placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="${t('Sync-Code')}">
        <button class="btn btn-soft" type="submit">${t('Verbinden')}</button>
      </form>`;
    $('#syncStart').onclick = async () => {
      try { await enableSync(newCode()); toast(t('Sync gestartet'), { tone: 'good' }); await render(); }
      catch (e) { disableSync(); toast(e.message, { tone: 'bad' }); }
    };
    $('#syncJoin').onsubmit = async e => {
      e.preventDefault();
      const c = normalizeCode($('#syncCodeInput').value);
      if (c.replace(/-/g, '').length !== 25) { toast(t('Der Code hat 25 Zeichen.'), { tone: 'bad' }); return; }
      await join(c);
    };
    return;
  }
  const link = syncLink(code);
  const last = lastSync();
  body.innerHTML = `
    <h2 class="dlg-title" id="syncTitle">${icon('checkCircle', { size: 22 })}${t('Geräte verbunden')}</h2>
    <p>${t('Scanne den QR-Code mit der Kamera des anderen Geräts — oder schick dir den Link.')}</p>
    <div class="sync-qr" id="syncQr">${icon('refresh', { size: 22 })}</div>
    <div class="sync-code"><code>${escapeHtml(code)}</code></div>
    <div class="row-btns">
      <button class="btn btn-soft" id="syncShare">${icon('share', { size: 16 })}${t('Link teilen')}</button>
      <button class="btn btn-soft" id="syncNowBtn">${icon('refresh', { size: 16 })}${t('Jetzt abgleichen')}</button>
    </div>
    <p class="fine">${t('Zuletzt abgeglichen: {when}. Wer den Code kennt, sieht deine Favoriten &amp; Co. — nur mit eigenen Geräten oder Leuten teilen, denen du vertraust.', { when: last ? timeAgo(last.getTime()) : t('noch nie') })}</p>
    <button class="link-btn danger" id="syncOff">${icon('x', { size: 14 })}${t('Dieses Gerät trennen')}</button>`;
  try { $('#syncQr').innerHTML = await qrSvg(link); } catch (e) { $('#syncQr').innerHTML = `<p class="fine">${escapeHtml(e.message)}</p>`; }
  $('#syncShare').onclick = async () => {
    const r = await shareLink({ title: 'Bier-Locator Sync', text: t('Verbinde dein Gerät mit meinem Bier-Locator'), url: link });
    if (r === 'copied') toast(t('Link kopiert'), { tone: 'good' });
  };
  $('#syncNowBtn').onclick = async () => {
    try { const ch = await syncNow(); toast(ch ? t('Neue Daten übernommen') : t('Alles aktuell'), { tone: 'good' }); await render(); }
    catch (e) { toast(e.message, { tone: 'bad' }); }
  };
  $('#syncOff').onclick = async () => {
    disableSync();
    toast(t('Gerät getrennt — die Daten bleiben hier erhalten.'));
    await render();
  };
}

async function join(code) {
  try {
    await enableSync(code);
    toast(t('Verbunden — Daten werden zusammengeführt.'), { tone: 'good', ms: 3500 });
    await render();
  } catch (e) {
    disableSync();
    toast(t('Verbinden fehlgeschlagen: {msg}', { msg: e.message }), { tone: 'bad' });
  }
}

// Aufruf über einen Link "#sync=CODE"
export async function joinFromLink(code) {
  const c = normalizeCode(code);
  if (c.replace(/-/g, '').length !== 25) return;
  if (syncCode() === c) { openSync(); return; }
  if (syncCode() && !confirm(t('Dieses Gerät ist schon mit anderen Geräten verbunden. Stattdessen mit dem neuen Code verbinden?'))) return;
  await join(c);
  openDialog($('#syncDialog'));
}

export function closeSync() { closeDialog($('#syncDialog')); }
