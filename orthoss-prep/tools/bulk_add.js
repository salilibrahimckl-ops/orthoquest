// Adds a batch of Claude-written questions to my-questions.json (used by parallel writer sessions).
//   node bulk_add.js <batch.json> <worker-tag>
// batch.json: [{"topic":"Trauma","sub":"ankle fractures","q":"..","o":["..","..","..",".."],"a":0,"e":".."}, ...]
// Invalid or near-duplicate questions are skipped and listed; the rest are added with ids cai<date>_<tag>NNN.
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..');
const TOPICS = ["Trauma","Spine","Arthroplasty","Sports & Arthroscopy","Paediatric Ortho","Hand & Upper Limb","Foot & Ankle","Oncology","Basic Sciences","Infection & Metabolic"];
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { return d } };
const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const STOPW = new Set('the of a an is in to and for which following all except are with by on at as or most not be from what true false this that patient year old'.split(' '));
const words = t => new Set(norm(t).split(' ').filter(x => x.length > 2 && !STOPW.has(x)));
const jac = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / Math.max(1, a.size + b.size - i) };
const istDay = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

const [bf, tagArg] = process.argv.slice(2);
if (!bf || !tagArg) { console.error('usage: node bulk_add.js <batch.json> <worker-tag>'); process.exit(1) }
let batch = readJ(bf, null); if (batch && !Array.isArray(batch)) batch = batch.written || batch.items;
if (!Array.isArray(batch)) { console.error(bf + ' is not a JSON array'); process.exit(1) }
const mF = path.join(DIR, 'my-questions.json'), mine = readJ(mF, { items: [], deleted: [], overrides: {} });
const bank = readJ(path.join(DIR, 'questions.json'), { raw: [] }).raw.map(r => ({ q: r[2], o: r[3] }));
const pool = bank.concat(mine.items);
const seen = new Set(pool.map(q => norm(q.q)));
const W = pool.map(q => words(q.q + ' ' + q.o.join(' ')));

function problem(x) {
  if (!x || typeof x.q !== 'string' || x.q.trim().length < 15) return 'question text missing or too short';
  if (!TOPICS.includes(x.topic)) return 'unknown topic ' + x.topic;
  if (!Array.isArray(x.o) || x.o.length !== 4 || x.o.some(o => typeof o !== 'string' || !o.trim())) return 'needs exactly 4 non-empty options';
  if (new Set(x.o.map(norm)).size !== 4) return 'options are not all different';
  if (x.o.some(o => /(all|none|both) of the above/i.test(o))) return 'no all/none/both of the above';
  if (!(Number.isInteger(+x.a) && +x.a >= 0 && +x.a < 4)) return 'a must be 0-3';
  if (typeof x.e !== 'string' || x.e.trim().length < 20) return 'explanation missing or too short';
  if (seen.has(norm(x.q))) return 'exact duplicate of an existing question';
  const w = words(x.q + ' ' + x.o.join(' '));
  let best = 0, bi = -1; W.forEach((v, i) => { const s = jac(w, v); if (s > best) { best = s; bi = i } });
  if (best >= 0.6) return `too similar (${Math.round(best * 100)}%) to existing: ${pool[bi].q.slice(0, 100)}`;
  return null;
}

const tag = 'cai' + istDay().replace(/-/g, '') + '_' + tagArg.replace(/[^a-z0-9]/gi, '') + '_';
let n = mine.items.filter(q => String(q.id).startsWith(tag)).map(q => +String(q.id).slice(tag.length) || 0).reduce((a, b) => Math.max(a, b), 0);
const added = [], skipped = [];
batch.forEach((x, i) => {
  const p = problem(x); if (p) return skipped.push(`#${i + 1} ${p} | ${String(x && x.q || '').slice(0, 70)}`);
  const it = { id: tag + String(++n).padStart(3, '0'), topic: x.topic, kind: 'AI-daily', q: x.q.trim(), o: x.o.map(o => o.trim()), a: +x.a, e: x.e.trim(), src: 'Exam-style', exam: x.exam || 'NEET-SS', year: '', fresh: true, proofed: false, reviewed: 'Claude' };
  if (x.sub) it.sub = String(x.sub);
  mine.items.push(it); added.push(it);
  seen.add(norm(it.q)); pool.push(it); W.push(words(it.q + ' ' + it.o.join(' ')));
});
mine.updated = new Date().toISOString();
fs.writeFileSync(mF, JSON.stringify(mine));
const ans = [0, 0, 0, 0]; added.forEach(q => ans[q.a]++);
console.log(`added ${added.length}, skipped ${skipped.length}; answer spread A-D ${ans.join('/')}`);
skipped.forEach(s => console.log('  skipped ' + s));
