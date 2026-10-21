// Preis per Foto: Getränkekarte fotografieren → Texterkennung (Tesseract.js, wird
// erst bei Bedarf geladen) → Vorschläge zum Abhaken. Gemeldet wird nur, was man
// bestätigt — und jeder Preis geht durch dieselbe Plausibilitätsprüfung.
import { parseMenuText, UNITS, validatePrice } from '../prices.js';
import { submitPrice } from '../community.js';
import { bumpStat } from '../store.js';
import { emit } from '../state.js';
import { icon } from '../icons.js';
import { escapeHtml, fmtEuro } from '../util.js';
import { $, openDialog, closeDialog, toast, beerLoader } from './dom.js';

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let lib = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!lib) {
    lib = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TESSERACT;
      s.onload = () => resolve(window.Tesseract);
      s.onerror = () => { lib = null; reject(new Error('Texterkennung konnte nicht geladen werden (offline?).')); };
      document.head.appendChild(s);
    });
  }
  return lib;
}

// Datei wählen (am Handy direkt die Kamera) und erkennen.
export function photoMenu(place, onDone) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';
  input.onchange = () => { if (input.files[0]) recognize(place, input.files[0], onDone); };
  input.click();
}

async function recognize(place, file, onDone) {
  const dlg = $('#scanDialog');
  const url = URL.createObjectURL(file);
  $('#scanBody').innerHTML = `
    <h2 class="dlg-title" id="scanTitle">${icon('scan', { size: 22 })}Getränkekarte lesen</h2>
    <img class="ocr-img" src="${url}" alt="Foto der Getränkekarte">
    <div id="ocrOut">${beerLoader('Texterkennung wird geladen…')}</div>`;
  openDialog(dlg);
  try {
    const T = await loadTesseract();
    const setMsg = t => { const el = document.querySelector('#ocrOut .beer-loader span'); if (el) el.textContent = t; };
    const { data } = await T.recognize(file, 'deu', {
      logger: m => { if (m.status === 'recognizing text') setMsg(`Lese Karte… ${Math.round(m.progress * 100)} %`); else if (/load/.test(m.status)) setMsg('Lade Sprachdaten (einmalig ein paar MB)…'); },
    });
    showCandidates(place, parseMenuText(data.text), data.text, onDone);
  } catch (e) {
    $('#ocrOut').innerHTML = `<div class="notice notice-bad">${icon('alertTriangle', { size: 18 })}<div>${escapeHtml(e.message || String(e))}</div></div>`;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

function showCandidates(place, list, raw, onDone) {
  const box = $('#ocrOut');
  if (!list.length) {
    box.innerHTML = `<div class="notice">${icon('info', { size: 18 })}<div>Keine Preise erkannt. Am besten gerade von vorne, gut beleuchtet und nur den Bier-Teil der Karte fotografieren.</div></div>
      <details class="ocr-raw"><summary>Erkannter Text</summary><pre>${escapeHtml(raw.slice(0, 2000))}</pre></details>`;
    return;
  }
  const unitOpts = sel => (sel ? '' : '<option value="" selected>Menge?</option>') + Object.entries(UNITS).filter(([k]) => !k.startsWith('kasten')).map(([k, u]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${u.label}</option>`).join('');
  box.innerHTML = `
    <p class="fine">Häkchen bei allem, was stimmt — Sorte, Menge und Preis lassen sich noch korrigieren.</p>
    <ul class="ocr-list">${list.map((c, i) => `<li data-i="${i}" ${c.guessed ? 'data-guessed' : ''}>
      <input type="checkbox" class="ocr-on" ${c.ok && c.beerish && !c.guessed ? 'checked' : ''} aria-label="Übernehmen">
      <input class="ocr-beer" value="${escapeHtml(c.beer)}" maxlength="40" aria-label="Sorte">
      <select class="ocr-unit" aria-label="Menge">${unitOpts(c.unit)}</select>
      <div class="price-input"><input class="ocr-price" inputmode="decimal" value="${c.price.toFixed(2).replace('.', ',')}" aria-label="Preis"><span>€</span></div>
      <small class="ocr-msg">${c.message ? escapeHtml(c.message) : !c.beerish ? 'Bier? Laut Name eher nicht.' : ''}</small>
    </li>`).join('')}</ul>
    <button class="btn btn-primary btn-big" id="ocrSend">${icon('check', { size: 18 })}<span></span></button>
    <details class="ocr-raw"><summary>Erkannter Text</summary><pre>${escapeHtml(raw.slice(0, 2000))}</pre></details>`;
  const rows = [...box.querySelectorAll('.ocr-list li')];
  const read = li => ({
    on: li.querySelector('.ocr-on').checked,
    beer: li.querySelector('.ocr-beer').value.trim(),
    unit: li.querySelector('.ocr-unit').value,
    price: li.querySelector('.ocr-price').value,
  });
  const check = () => {
    let n = 0;
    for (const li of rows) {
      const r = read(li);
      const v = validatePrice(r.price, r.unit, r.beer);
      li.classList.toggle('bad', r.on && !v.ok);
      li.querySelector('.ocr-msg').textContent = !v.ok ? v.message
        : li.hasAttribute('data-guessed') && r.unit === '0.5l' ? 'Menge nicht erkannt — 0,5 l angenommen, bitte prüfen.'
        : r.unit !== '0.5l' ? `= ${fmtEuro(v.per05)} pro 0,5 l` : '';
      if (r.on && v.ok) n++;
    }
    const btn = $('#ocrSend');
    btn.disabled = !n;
    btn.querySelector('span').textContent = n ? `${n} Preis${n === 1 ? '' : 'e'} melden` : 'Nichts ausgewählt';
  };
  box.addEventListener('input', check);
  box.addEventListener('change', check);
  check();
  $('#ocrSend').onclick = async () => {
    const btn = $('#ocrSend');
    btn.disabled = true;
    let ok = 0, fail = 0;
    for (const li of rows) {
      const r = read(li);
      if (!r.on || !validatePrice(r.price, r.unit, r.beer).ok) continue;
      try { await submitPrice(place.id, { beer: r.beer, price: r.price, unit: r.unit }); ok++; li.classList.add('sent'); bumpStat('prices'); emit('price-reported'); }
      catch (e) { fail++; li.querySelector('.ocr-msg').textContent = e.message; }
    }
    if (ok) {
      toast(`${ok} Preis${ok === 1 ? '' : 'e'} gemeldet — danke! 🍻`, { tone: 'good' });
      closeDialog($('#scanDialog'));
      onDone && onDone();
    } else if (fail) { btn.disabled = false; toast('Nichts gemeldet — siehe Hinweise.', { tone: 'bad' }); }
  };
}
