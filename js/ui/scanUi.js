// Barcode-Scanner: Dose/Flasche/Kiste scannen → Produkt über Open Food Facts erkennen
// → Biersorte und Gebinde im Preisformular vorausfüllen, Online-Preis der Kette zeigen.
import { chainPricesFor } from '../chainPrices.js';
import { parsePackLabel } from '../prices.js';
import { icon } from '../icons.js';
import { escapeHtml, fetchWithTimeout } from '../util.js';
import { $, openDialog, closeDialog, toast } from './dom.js';

let stream = null, raf = null;

async function getDetector() {
  const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
  if ('BarcodeDetector' in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      if (formats.some(f => supported.includes(f))) return new window.BarcodeDetector({ formats });
    } catch (e) { /* Polyfill nehmen */ }
  }
  const mod = await import('https://cdn.jsdelivr.net/npm/barcode-detector@2/dist/es/pure.min.js');
  return new mod.BarcodeDetector({ formats });
}

function stop() {
  cancelAnimationFrame(raf);
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
}

export async function openScanner(place, onFound) {
  const dlg = $('#scanDialog');
  $('#scanBody').innerHTML = `
    <h2 class="dlg-title" id="scanTitle">${icon('scan', { size: 22 })}Barcode scannen</h2>
    <div class="scan-view"><video id="scanVideo" playsinline muted></video><div class="scan-frame"></div></div>
    <p class="fine center" id="scanHint">Halte den Strichcode der Dose, Flasche oder Kiste in den Rahmen.</p>
    <form class="sync-join" id="scanManual">
      <input id="scanEan" inputmode="numeric" placeholder="… oder Nummer eintippen" pattern="[0-9]{8,14}" autocomplete="off">
      <button class="btn btn-soft" type="submit">Suchen</button>
    </form>
    <div id="scanResult"></div>`;
  openDialog(dlg);
  dlg.addEventListener('close', stop, { once: true });

  const handle = async code => {
    stop();
    $('#scanHint').textContent = `Gefunden: ${code} — suche Produkt…`;
    const prod = await lookup(code);
    showResult(prod, place, onFound, dlg);
  };
  $('#scanManual').onsubmit = e => { e.preventDefault(); const v = $('#scanEan').value.trim(); if (/^\d{8,14}$/.test(v)) handle(v); };

  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Kamera wird von diesem Browser nicht unterstützt.');
    const detector = await getDetector();
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
    const video = $('#scanVideo');
    video.srcObject = stream;
    await video.play();
    let last = 0;
    const tick = async now => {
      if (!stream) return;
      if (now - last > 250 && video.readyState >= 2) {
        last = now;
        try {
          const codes = await detector.detect(video);
          if (codes.length) { if (navigator.vibrate) navigator.vibrate(60); handle(codes[0].rawValue); return; }
        } catch (e) { /* nächster Frame */ }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  } catch (e) {
    $('#scanHint').textContent = e.name === 'NotAllowedError' ? 'Kamerazugriff nicht erlaubt — tipp die Nummer unter dem Strichcode ein.' : `${e.message} Tipp die Nummer unter dem Strichcode ein.`;
    $('.scan-view').hidden = true;
  }
}

async function lookup(ean) {
  try {
    const res = await fetchWithTimeout(`https://world.openfoodfacts.org/api/v2/product/${ean}.json?fields=product_name,product_name_de,brands,quantity,categories_tags`, {}, 10000);
    const d = await res.json();
    if (d.status !== 1 || !d.product) return { ean, found: false };
    const p = d.product;
    const brand = (p.brands || '').split(',')[0].trim();
    let name = (p.product_name_de || p.product_name || '').trim();
    if (brand && !name.toLowerCase().includes(brand.toLowerCase())) name = `${brand} ${name}`;
    return { ean, found: true, beer: name.replace(/\s+/g, ' ').slice(0, 40), quantity: p.quantity || '', isBeer: (p.categories_tags || []).some(c => /beer|bier/.test(c)) };
  } catch (e) {
    return { ean, found: false, error: true };
  }
}

function showResult(prod, place, onFound, dlg) {
  const box = $('#scanResult');
  if (!prod.found) {
    box.innerHTML = `<div class="notice">${icon('info', { size: 18 })}<div>${prod.error ? 'Produktdatenbank nicht erreichbar.' : 'Produkt nicht in der Datenbank.'} Trag die Sorte einfach selbst ein.</div></div>`;
    return;
  }
  const unit = parsePackLabel(prod.quantity);
  // Passenden Online-Preis der Kette suchen (gleiche Wörter im Namen)
  const words = prod.beer.toLowerCase().split(/\s+/).filter(w => w.length > 2).slice(0, 3);
  const online = place ? chainPricesFor(place).filter(x => words.every(w => x.beer.toLowerCase().includes(w)))
    .sort((a, b) => (a.unit === unit ? 0 : 1) - (b.unit === unit ? 0 : 1) || a.promo - b.promo).slice(0, 3) : [];
  box.innerHTML = `
    <div class="scan-hit">
      <b>${escapeHtml(prod.beer)}</b><small>${escapeHtml(prod.quantity)}${prod.isBeer ? '' : ' · laut Datenbank evtl. kein Bier'}</small>
      ${online.length ? `<p class="fine">Online bei dieser Kette: ${online.map(o => `${escapeHtml(o.package)} ${o.price.toFixed(2).replace('.', ',')} €`).join(' · ')}</p>` : ''}
      <button class="btn btn-primary" id="scanUse">${icon('check', { size: 17 })}Übernehmen &amp; Preis eintragen</button>
    </div>`;
  $('#scanUse').onclick = () => {
    closeDialog(dlg);
    onFound({ beer: prod.beer, unit });
    toast('Jetzt nur noch den Preis vom Regal eintippen', { ms: 2500 });
  };
}

export function closeScanner() { stop(); }
