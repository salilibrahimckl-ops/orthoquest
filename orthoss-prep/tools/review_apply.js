// Applies Claude's review decisions (review/decisions.json) and publishes the questions.
//   node review_apply.js
// decisions.json:
// { "drafts": [ {"id":"ai..","action":"keep"} | {"id":"ai..","action":"fix","q":"..","o":["..","..","..",".."],"a":0,"e":"..","topic":"(optional)"} | {"id":"ai..","action":"reject","reason":".."} ],
//   "flags":  [ {"id":"b12","action":"discard"} | {"id":"b12","action":"confirm","sug":"exact option text or null","issue":".."}
//               | {"id":"c..","action":"fix","q":"..","o":[..],"a":0,"e":".."} | {"id":"c..","action":"delete","reason":".."} ],
//   "written":[ {"topic":"..","q":"..","o":[..],"a":0,"e":".."} ] }
// Nothing is written if any decision is invalid; the errors are printed so they can be corrected.
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..'), RV = path.join(DIR, 'review');
const TOPICS = ["Trauma","Spine","Arthroplasty","Sports & Arthroscopy","Paediatric Ortho","Hand & Upper Limb","Foot & Ankle","Oncology","Basic Sciences","Infection & Metabolic"];
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { return d } };
const istDay = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const errs = [];
const dec = readJ(path.join(RV, 'decisions.json'), null); if (!dec) { console.error('review/decisions.json missing or not valid JSON'); process.exit(1) }
const inp = readJ(path.join(RV, 'input.json'), { drafts: [], flags: [] });
const dF = path.join(DIR, 'ai-drafts.json'), drafts = readJ(dF, {}); drafts.pending = drafts.pending || []; drafts.pendingFlags = drafts.pendingFlags || [];
const mF = path.join(DIR, 'my-questions.json'), mine = readJ(mF, { items: [], deleted: [], overrides: {} }); mine.deleted = mine.deleted || []; mine.overrides = mine.overrides || {};
const pF = path.join(DIR, 'proof-flags.json'), pf = readJ(pF, { flags: [] });
const bank = readJ(path.join(DIR, 'questions.json'), { raw: [] }).raw;
const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function checkQ(x, where) {
  if (!x || typeof x.q !== 'string' || x.q.trim().length < 15) return errs.push(where + ': question text missing or too short');
  if (!Array.isArray(x.o) || x.o.length !== 4 || x.o.some(o => typeof o !== 'string' || !o.trim())) return errs.push(where + ': needs exactly 4 non-empty options');
  if (new Set(x.o.map(norm)).size !== 4) errs.push(where + ': options are not all different');
  if (x.o.some(o => /^(all|none) of the above$/i.test(o.trim()))) errs.push(where + ': no all/none of the above');
  if (!(Number.isInteger(+x.a) && +x.a >= 0 && +x.a < 4)) errs.push(where + ': a must be 0-3');
  if (typeof x.e !== 'string' || x.e.trim().length < 20) errs.push(where + ': explanation missing or too short');
  if (x.topic && !TOPICS.includes(x.topic)) errs.push(where + ': unknown topic ' + x.topic);
}
const byDraft = new Map(drafts.pending.map(q => [q.id, q]));
(dec.drafts || []).forEach((d, i) => { const w = 'drafts[' + i + '] ' + d.id; if (!byDraft.has(d.id)) return errs.push(w + ': not a pending draft');
  if (d.action === 'fix') checkQ(d, w); else if (d.action === 'keep') checkQ(byDraft.get(d.id), w + ' (as drafted; use fix instead)');
  else if (d.action !== 'reject') errs.push(w + ': action must be keep, fix or reject') });
(dec.written || []).forEach((x, i) => { checkQ(x, 'written[' + i + ']'); if (!x.topic) errs.push('written[' + i + ']: topic required') });
(dec.flags || []).forEach((f, i) => { const w = 'flags[' + i + '] ' + f.id;
  if (f.action === 'fix') checkQ(f, w); else if (!['discard', 'confirm', 'delete'].includes(f.action)) errs.push(w + ': action must be discard, confirm, fix or delete');
  if ((f.action === 'fix' || f.action === 'delete') && !mine.items.some(q => q.id === f.id)) errs.push(w + ': fix/delete only for added questions; use confirm for b-ids');
  if (f.action === 'confirm' && /^b\d+$/.test(f.id)) { const r = bank[+f.id.slice(1) - 1]; if (!r) errs.push(w + ': no such bank question'); else if (f.sug != null && !r[3].includes(f.sug)) errs.push(w + ': sug must be one of the options exactly') } });
// whole-run duplicate check among new questions
const newQs = (dec.drafts || []).filter(d => d.action !== 'reject').map(d => d.action === 'fix' ? d : byDraft.get(d.id)).concat(dec.written || []);
const seen = new Set(mine.items.map(q => norm(q.q)).concat(bank.map(r => norm(r[2]))));
newQs.forEach((x, i) => { if (!x) return; const k = norm(x.q); if (seen.has(k)) errs.push('duplicate question text: ' + x.q.slice(0, 80)); seen.add(k) });
if (errs.length) { console.error('NOT APPLIED. Fix these in review/decisions.json and run again:\n- ' + errs.join('\n- ')); process.exit(1) }

// apply
const day = istDay(), tag = 'cai' + day.replace(/-/g, '') + '_';
let n = mine.items.filter(q => String(q.id).startsWith(tag)).map(q => +String(q.id).slice(tag.length) || 0).reduce((a, b) => Math.max(a, b), 0);
const nid = () => tag + String(++n).padStart(3, '0');
const item = (x, topic, exam) => ({ id: nid(), topic: x.topic || topic, kind: 'AI-daily', q: x.q.trim(), o: x.o.map(o => o.trim()), a: +x.a, e: x.e.trim(), src: 'Exam-style', exam: exam || 'NEET-SS', year: '', fresh: true, proofed: true, reviewed: 'Claude' });
const status = {}; let kept = 0, fixed = 0, rejected = 0, written = 0;
for (const d of dec.drafts || []) { const q = byDraft.get(d.id);
  if (d.action === 'reject') { rejected++; status[d.id] = { status: 'rejected', reason: d.reason || '' }; continue }
  const it = item(d.action === 'fix' ? d : q, q.topic, q.exam); mine.items.push(it); d.action === 'fix' ? fixed++ : kept++;
  status[d.id] = { status: d.action === 'fix' ? 'fixed' : 'kept', pub: it.id } }
for (const x of dec.written || []) { mine.items.push(item(x, x.topic)); written++ }
let fFixed = 0, fConf = 0, fDisc = 0; const t = Date.now();
for (const f of dec.flags || []) {
  if (f.action === 'discard') { fDisc++; continue }
  if (f.action === 'confirm') { const r = bank[+String(f.id).slice(1) - 1]; fConf++;
    pf.flags.unshift({ id: f.id, q: r ? r[2].slice(0, 200) : '', key: r ? r[3][r[4]] : '', sug: f.sug || null, issue: f.issue || '', by: 'Claude', strong: !!f.sug, day, t }); continue }
  if (f.action === 'delete') { mine.items = mine.items.filter(q => q.id !== f.id); if (!mine.deleted.includes(f.id)) mine.deleted.push(f.id); fFixed++; continue }
  const q = mine.items.find(x => x.id === f.id); q.q = f.q.trim(); q.o = f.o.map(o => o.trim()); q.a = +f.a; q.e = f.e.trim();
  mine.overrides[f.id] = { q: q.q, o: q.o, aText: q.o[q.a], e: q.e, ok: true, t }; fFixed++ }
const doneD = new Set((dec.drafts || []).map(d => d.id)), doneF = new Set((dec.flags || []).map(f => f.id));
drafts.pending = drafts.pending.filter(q => !doneD.has(q.id)); drafts.pendingFlags = drafts.pendingFlags.filter(f => !doneF.has(f.id));
drafts.reviewLog = (drafts.reviewLog || []).concat([{ at: new Date().toISOString(), kept, fixed, rejected, written, flagsFixed: fFixed, flagsConfirmed: fConf, flagsDiscarded: fDisc, remaining: drafts.pending.length, remainingFlags: drafts.pendingFlags.length }]).slice(-300);
mine.updated = new Date().toISOString(); pf.flags = pf.flags.slice(0, 500); pf.updated = mine.updated;
// mark each draft's outcome in the daily drafts archive the app shows
const dd = path.join(DIR, 'drafts');
if (fs.existsSync(dd)) for (const f of fs.readdirSync(dd).filter(x => /^\d{4}-\d\d-\d\d\.json$/.test(x))) {
  const p = path.join(dd, f), a = readJ(p, null); if (!a) continue; let ch = false;
  a.items.forEach(q => { if (status[q.id]) { Object.assign(q, status[q.id]); ch = true } }); if (ch) fs.writeFileSync(p, JSON.stringify(a)) }
fs.writeFileSync(mF, JSON.stringify(mine)); fs.writeFileSync(dF, JSON.stringify(drafts, null, 1)); fs.writeFileSync(pF, JSON.stringify(pf));
const today = mine.items.filter(q => String(q.id).startsWith(tag)).length;
const msg = `${kept + fixed + written} new questions (${kept + fixed} from drafts, ${written} written), ${rejected} rejected; flags ${fFixed} fixed, ${fConf} confirmed, ${fDisc} discarded; today ${today}; ${drafts.pending.length} drafts waiting`;
fs.writeFileSync(path.join(RV, 'last-message.txt'), 'Ortho preSSaleel: ' + msg);
try { fs.unlinkSync(path.join(RV, 'decisions.json')) } catch (e) {}
console.log('APPLIED: ' + msg);
