// (rebuild check)
// Builds phone-friendly PDFs from the notes: one per subtopic and one per topic.
//   node notes_pdf.js [--all]
// Writes pdf/<topic>.pdf, pdf/<topic>/<subtopic>.pdf and pdf/manifest.json. Only rebuilds what changed (unless --all).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const DIR = path.join(__dirname, '..'), ND = path.join(DIR, 'notes'), PD = path.join(DIR, 'pdf');
const slug = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inl = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<i>$2</i>');
function md(src) {
  const L = String(src).split('\n'); let h = '', i = 0;
  while (i < L.length) {
    const l = L[i]; let m;
    if (/^\s*$/.test(l)) { i++; continue }
    if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) { const n = Math.min(4, m[1].length + 1); h += `<h${n}>${inl(m[2])}</h${n}>`; i++; continue }
    if (/^\s*\|/.test(l)) { const rows = []; while (i < L.length && /^\s*\|/.test(L[i])) { rows.push(L[i]); i++ }
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const body = rows.slice(1).filter(r => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
      h += `<table><thead><tr>${cells(rows[0]).map(c => `<th>${inl(c)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${cells(r).map(c => `<td>${inl(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`; continue }
    if (/^>\s?/.test(l)) { const t = []; while (i < L.length && /^>\s?/.test(L[i])) { t.push(L[i].replace(/^>\s?/, '')); i++ } h += `<div class="pearl">${inl(t.join(' '))}</div>`; continue }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) { const ord = /^\s*\d+\./.test(l); const items = [];
      while (i < L.length && /^\s*([-*]|\d+\.)\s+/.test(L[i])) { items.push([(/^(\s*)/.exec(L[i])[1] || '').length >= 2 ? 1 : 0, L[i].replace(/^\s*([-*]|\d+\.)\s+/, '')]); i++ }
      let out = `<${ord ? 'ol' : 'ul'}>`, open = false;
      items.forEach(([lv, t], k) => { if (lv === 0) { if (open) { out += '</ul>'; open = false } if (k) out += '</li>'; out += `<li>${inl(t)}` }
        else { if (!open) { out += '<ul>'; open = true } out += `<li>${inl(t)}</li>` } });
      if (open) out += '</ul>'; out += `</li></${ord ? 'ol' : 'ul'}>`; h += out; continue }
    const t = []; while (i < L.length && L[i].trim() && !/^(#{1,4}\s|\s*\||>|\s*([-*]|\d+\.)\s)/.test(L[i])) { t.push(L[i]); i++ } h += `<p>${inl(t.join(' '))}</p>`
  }
  return h;
}
const CSS = `@page{size:148mm 210mm;margin:13mm 10mm 14mm 10mm}
body{font-family:"Noto Sans","DejaVu Sans",Arial,sans-serif;font-size:10.4pt;line-height:1.5;color:#17203a}
h1{font-size:17pt;margin:0 0 2mm;color:#2b3a8c}h1::first-letter{text-transform:uppercase}.top{font-size:8.5pt;color:#6b7393;text-transform:uppercase;letter-spacing:.08em;margin-bottom:1mm}
h2{font-size:13pt;color:#fff;background:#3949ab;padding:1.6mm 3mm;border-radius:2mm;margin:5mm 0 2mm;page-break-after:avoid}
h3{font-size:11.5pt;color:#2b3a8c;margin:4mm 0 1.5mm;border-bottom:.4mm solid #c9cfe8;padding-bottom:.6mm;page-break-after:avoid}h4{font-size:10.8pt;margin:3mm 0 1mm;color:#2b3a8c}
p{margin:1.4mm 0}ul,ol{margin:1mm 0 2mm;padding-left:5mm}li{margin:.7mm 0}li ul{margin:.6mm 0}b{color:#0d1530}
table{border-collapse:collapse;width:100%;margin:2mm 0 3mm;font-size:9.2pt;page-break-inside:auto}tr{page-break-inside:avoid}
th{background:#e6e9f7;color:#1c2a6b;text-align:left}th,td{border:.3mm solid #c3c9e3;padding:1.2mm 1.6mm;vertical-align:top}
.pearl{border-left:1.4mm solid #e8a317;background:#fff6dd;padding:2mm 3mm;border-radius:1.5mm;margin:3mm 0;page-break-inside:avoid}
.sub{page-break-before:always}.sub:first-of-type{page-break-before:auto}.foot{margin-top:6mm;font-size:8pt;color:#6b7393}
.cover{border:.6mm solid #3949ab;border-radius:3mm;padding:5mm;margin-bottom:5mm}.cover ol{columns:1}`;
const page = (title, inner) => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${inner}</body></html>`;
const header = (topic) => `<div style="font-size:7.5pt;width:100%;padding:0 10mm;color:#8a90aa;display:flex;justify-content:space-between"><span>Ortho preSSaleel · High-yield notes</span><span>${esc(topic)}</span></div>`;
const footer = `<div style="font-size:7.5pt;width:100%;text-align:center;color:#8a90aa"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`;

(async () => {
  const all = process.argv.includes('--all');
  const idx = JSON.parse(fs.readFileSync(path.join(ND, 'index.json'), 'utf8'));
  fs.mkdirSync(PD, { recursive: true });
  const manF = path.join(PD, 'manifest.json'); let man = {}; try { man = JSON.parse(fs.readFileSync(manF, 'utf8')) } catch (e) {}
  const { chromium } = require('playwright'); const b = await chromium.launch(); const pg = await b.newPage();
  const print = async (html, out, topic) => { await pg.setContent(html, { waitUntil: 'load' }); fs.mkdirSync(path.dirname(out), { recursive: true });
    await pg.pdf({ path: out, width: '148mm', height: '210mm', printBackground: true, displayHeaderFooter: true, headerTemplate: header(topic), footerTemplate: footer, margin: { top: '13mm', bottom: '14mm', left: '10mm', right: '10mm' } }) };
  let built = 0; const newMan = { updated: new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10), topics: {} };
  for (const [topic, e] of Object.entries(idx.topics)) {
    const d = JSON.parse(fs.readFileSync(path.join(ND, e.file), 'utf8')); const ts = slug(topic);
    const subs = Object.entries(d.subs); const tHash = crypto.createHash('sha1').update(JSON.stringify(subs)).digest('hex').slice(0, 12);
    const entry = { pdf: `pdf/${ts}.pdf`, hash: tHash, subs: {} }; const old = (man.topics || {})[topic] || { subs: {} };
    for (const [sub, n] of subs) { const h = crypto.createHash('sha1').update(n.md).digest('hex').slice(0, 12); const rel = `pdf/${ts}/${slug(sub)}.pdf`;
      entry.subs[sub] = { pdf: rel, hash: h, level: n.level || 1, updated: n.updated };
      if (all || !old.subs[sub] || old.subs[sub].hash !== h || !fs.existsSync(path.join(DIR, rel))) {
        await print(page(sub, `<div class="top">${esc(topic)} · NEET-SS / FET / INI-SS</div><h1>${esc(sub)}</h1>${md(n.md)}<div class="foot">Written by Claude for Ortho preSSaleel · updated ${esc(n.updated || '')}. Check doubtful points in a standard textbook.</div>`), path.join(DIR, rel), topic); built++ } }
    if (all || old.hash !== tHash || !fs.existsSync(path.join(DIR, entry.pdf))) {
      const cover = `<div class="cover"><div class="top">NEET-SS / FET / INI-SS high-yield notes</div><h1>${esc(topic)}</h1><ol>${subs.map(([s]) => `<li>${esc(s)}</li>`).join('')}</ol></div>`;
      await print(page(topic, cover + subs.map(([s, n]) => `<div class="sub"><h1>${esc(s)}</h1>${md(n.md)}</div>`).join('')), path.join(DIR, entry.pdf), topic); built++ }
    newMan.topics[topic] = entry;
  }
  await b.close(); fs.writeFileSync(manF, JSON.stringify(newMan));
  console.log(`PDFs built: ${built}. Topics: ${Object.keys(newMan.topics).join(', ')}`);
})().catch(e => { console.error(e); process.exit(1) });
