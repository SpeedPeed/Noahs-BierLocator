// Dialog "Geräte verbinden": QR-Code/Link anzeigen, Code eingeben, trennen.
import { syncAvailable, syncCode, lastSync, newCode, normalizeCode, syncLink, enableSync, disableSync, qrSvg, syncNow } from '../sync.js';
import { icon } from '../icons.js';
import { escapeHtml, timeAgo } from '../util.js';
import { $, openDialog, closeDialog, toast } from './dom.js';
import { shareLink } from '../share.js';

export async function openSync() {
  const dlg = $('#syncDialog');
  await render();
  openDialog(dlg);
}

async function render() {
  const body = $('#syncBody');
  if (!syncAvailable()) {
    body.innerHTML = `<h2 class="dlg-title">${icon('refresh', { size: 22 })}Geräte verbinden</h2>
      <p class="fine">Für den Geräte-Sync muss Supabase eingerichtet sein (siehe README).</p>`;
    return;
  }
  const code = syncCode();
  if (!code) {
    body.innerHTML = `
      <h2 class="dlg-title" id="syncTitle">${icon('refresh', { size: 22 })}Geräte verbinden</h2>
      <p>Favoriten, Vorlieben, Promille-Log, Tagebuch und Preisalarme auf allen deinen Geräten gleich — ohne Konto.</p>
      <div class="sync-choice">
        <button class="btn btn-primary btn-big" id="syncStart">${icon('plus', { size: 18 })}Sync starten</button>
        <p class="fine center">Danach zeigt dieses Gerät einen QR-Code, den du mit dem anderen Handy scannst.</p>
      </div>
      <div class="sync-or"><span>oder Code vom anderen Gerät eingeben</span></div>
      <form class="sync-join" id="syncJoin">
        <input id="syncCodeInput" type="text" placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Sync-Code">
        <button class="btn btn-soft" type="submit">Verbinden</button>
      </form>`;
    $('#syncStart').onclick = async () => {
      try { await enableSync(newCode()); toast('Sync gestartet', { tone: 'good' }); await render(); }
      catch (e) { disableSync(); toast(e.message, { tone: 'bad' }); }
    };
    $('#syncJoin').onsubmit = async e => {
      e.preventDefault();
      const c = normalizeCode($('#syncCodeInput').value);
      if (c.replace(/-/g, '').length !== 25) { toast('Der Code hat 25 Zeichen.', { tone: 'bad' }); return; }
      await join(c);
    };
    return;
  }
  const link = syncLink(code);
  const last = lastSync();
  body.innerHTML = `
    <h2 class="dlg-title" id="syncTitle">${icon('checkCircle', { size: 22 })}Geräte verbunden</h2>
    <p>Scanne den QR-Code mit der Kamera des anderen Geräts — oder schick dir den Link.</p>
    <div class="sync-qr" id="syncQr">${icon('refresh', { size: 22 })}</div>
    <div class="sync-code"><code>${escapeHtml(code)}</code></div>
    <div class="row-btns">
      <button class="btn btn-soft" id="syncShare">${icon('share', { size: 16 })}Link teilen</button>
      <button class="btn btn-soft" id="syncNowBtn">${icon('refresh', { size: 16 })}Jetzt abgleichen</button>
    </div>
    <p class="fine">Zuletzt abgeglichen: ${last ? timeAgo(last.getTime()) : 'noch nie'}. Wer den Code kennt, sieht deine Favoriten &amp; Co. — nur mit eigenen Geräten oder Leuten teilen, denen du vertraust.</p>
    <button class="link-btn danger" id="syncOff">${icon('x', { size: 14 })}Dieses Gerät trennen</button>`;
  try { $('#syncQr').innerHTML = await qrSvg(link); } catch (e) { $('#syncQr').innerHTML = `<p class="fine">${escapeHtml(e.message)}</p>`; }
  $('#syncShare').onclick = async () => {
    const r = await shareLink({ title: 'Bier-Locator Sync', text: 'Verbinde dein Gerät mit meinem Bier-Locator', url: link });
    if (r === 'copied') toast('Link kopiert', { tone: 'good' });
  };
  $('#syncNowBtn').onclick = async () => {
    try { const ch = await syncNow(); toast(ch ? 'Neue Daten übernommen' : 'Alles aktuell', { tone: 'good' }); await render(); }
    catch (e) { toast(e.message, { tone: 'bad' }); }
  };
  $('#syncOff').onclick = async () => {
    disableSync();
    toast('Gerät getrennt — die Daten bleiben hier erhalten.');
    await render();
  };
}

async function join(code) {
  try {
    await enableSync(code);
    toast('Verbunden — Daten werden zusammengeführt.', { tone: 'good', ms: 3500 });
    await render();
  } catch (e) {
    disableSync();
    toast('Verbinden fehlgeschlagen: ' + e.message, { tone: 'bad' });
  }
}

// Aufruf über einen Link "#sync=CODE"
export async function joinFromLink(code) {
  const c = normalizeCode(code);
  if (c.replace(/-/g, '').length !== 25) return;
  if (syncCode() === c) { openSync(); return; }
  if (syncCode() && !confirm('Dieses Gerät ist schon mit anderen Geräten verbunden. Stattdessen mit dem neuen Code verbinden?')) return;
  await join(c);
  openDialog($('#syncDialog'));
}

export function closeSync() { closeDialog($('#syncDialog')); }
