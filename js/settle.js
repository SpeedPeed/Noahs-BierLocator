// Runden-Abrechnung (DOM-frei, getestet in tests/): Wer hat wie viel ausgegeben,
// wer schuldet wem — mit möglichst wenigen Überweisungen.

// rounds: [{ payer, amount, participants: [id, …] }]. Ohne Teilnehmerliste zählt
// die ganze Runde (`everyone`). → Map id → Saldo (positiv = bekommt Geld zurück)
export function balances(rounds, everyone) {
  const bal = new Map(everyone.map(id => [id, 0]));
  for (const r of rounds) {
    const parts = r.participants && r.participants.length ? r.participants : everyone;
    if (!parts.length || !(r.amount > 0)) continue;
    const share = r.amount / parts.length;
    bal.set(r.payer, (bal.get(r.payer) || 0) + r.amount);
    for (const p of parts) bal.set(p, (bal.get(p) || 0) - share);
  }
  return bal;
}

// Gierig: größter Schuldner zahlt an größten Gläubiger. Rechnet in Cent.
// → [{ from, to, amount }]
export function settle(bal) {
  const cred = [], debt = [];
  for (const [id, v] of bal) {
    const c = Math.round(v * 100);
    if (c > 0) cred.push({ id, c }); else if (c < 0) debt.push({ id, c: -c });
  }
  cred.sort((a, b) => b.c - a.c);
  debt.sort((a, b) => b.c - a.c);
  const out = [];
  let i = 0, j = 0;
  while (i < debt.length && j < cred.length) {
    const x = Math.min(debt[i].c, cred[j].c);
    if (x > 1) out.push({ from: debt[i].id, to: cred[j].id, amount: x / 100 }); // 1-Cent-Rundungsreste ignorieren
    debt[i].c -= x; cred[j].c -= x;
    if (!debt[i].c) i++;
    if (!cred[j].c) j++;
  }
  return out;
}
