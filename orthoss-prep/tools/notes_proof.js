// Proofreading tracker for the full notes.
//   node notes_proof.js status            -> how many full notes are proofread / waiting
//   node notes_proof.js export N          -> writes the next N unchecked full notes to ../proof/<topic-slug>__<sub-slug>.md
//                                            (timetable order: earliest days first) and lists them
//   node notes_proof.js import "<summary>" -> reads every ../proof/*.md back into the notes, marks each as checked
//                                            (date + summary in ../proof-log.json), deletes the .md files, rebuilds index
// A note rewritten later by the notes writer loses its "checked" mark and is proofread again.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..'), ND = path.join(ROOT, 'notes'), PD = path.join(ROOT, 'proof');
const slug = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const day = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const files = () => fs.readdirSync(ND).filter(x => x.endsWith('.json') && x !== 'index.json');
const load = f => JSON.parse(fs.readFileSync(path.join(ND, f), 'utf8'));
function order() {
  let plan = []; try { plan = require(path.join(ROOT, 'plan-topics.json')).days || [] } catch (e) {}
  const rank = {}; plan.forEach((d, i) => { for (const t of [].concat(d.topics || d.topic || [])) for (const s of [].concat(d.read || d.subs || [])) { const k = t + '\u0000' + s; if (!(k in rank)) rank[k] = i } });
  const out = [];
  for (const f of files()) { const d = load(f); for (const [s, v] of Object.entries(d.subs)) if ((v.level || 1) >= 2) out.push({ f, topic: d.topic, sub: s, checked: v.checked, r: rank[d.topic + '\u0000' + s] ?? 1e9 }) }
  return out.sort((a, b) => a.r - b.r);
}
const [cmd, arg] = process.argv.slice(2);
if (cmd === 'status' || !cmd) {
  const o = order(), done = o.filter(x => x.checked).length;
  console.log(`${done} of ${o.length} full notes proofread; ${o.length - done} waiting.`);
} else if (cmd === 'export') {
  fs.mkdirSync(PD, { recursive: true });
  const next = order().filter(x => !x.checked).slice(0, +arg || 3);
  if (!next.length) { console.log('All full notes are proofread'); process.exit(0) }
  for (const x of next) { const p = path.join(PD, slug(x.topic) + '__' + slug(x.sub) + '.md');
    fs.writeFileSync(p, load(x.f).subs[x.sub].md); console.log(p + '   (' + x.topic + ' | ' + x.sub + ')') }
} else if (cmd === 'import') {
  if (!fs.existsSync(PD)) { console.log('nothing to import'); process.exit(0) }
  const logP = path.join(ROOT, 'proof-log.json'); let log = []; try { log = JSON.parse(fs.readFileSync(logP, 'utf8')) } catch (e) {}
  const all = order(); let n = 0;
  for (const m of fs.readdirSync(PD).filter(x => x.endsWith('.md'))) {
    const [ts, ss] = m.slice(0, -3).split('__'); const x = all.find(y => slug(y.topic) === ts && slug(y.sub) === ss);
    if (!x) { console.log('no matching note for ' + m); continue }
    const md = fs.readFileSync(path.join(PD, m), 'utf8'); if (md.length < 1000) throw new Error('note looks truncated: ' + m);
    const d = load(x.f); const v = d.subs[x.sub]; const changed = v.md !== md;
    d.subs[x.sub] = { ...v, md, checked: day, ...(changed ? { updated: day } : {}) };
    fs.writeFileSync(path.join(ND, x.f), JSON.stringify(d)); fs.unlinkSync(path.join(PD, m));
    log.push({ date: day, topic: x.topic, sub: x.sub, changed, summary: arg || '' }); n++;
  }
  fs.writeFileSync(logP, JSON.stringify(log, null, 1));
  cp.execFileSync('node', [path.join(__dirname, 'notes_index.js')], { stdio: 'inherit' });
  console.log(`imported ${n} proofread note(s)`);
} else console.log('usage: status | export N | import "<summary>"');
