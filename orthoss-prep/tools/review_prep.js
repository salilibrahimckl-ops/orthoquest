// Prepares a compact review sheet for Claude so it never has to load the whole question bank.
//   node review_prep.js [drafts=50] [flags=25]
// Writes review/input.md (what Claude reads) and review/input.json (what review_apply.js checks against).
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..'), RV = path.join(DIR, 'review');
const TOPICS = ["Trauma","Spine","Arthroplasty","Sports & Arthroscopy","Paediatric Ortho","Hand & Upper Limb","Foot & Ankle","Oncology","Basic Sciences","Infection & Metabolic"];
const L = 'ABCD';
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { return d } };
const normT = t => String(t || '').toLowerCase().replace(/<[^>]+>/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const STOPW = new Set('the of a an is in to and for which following all except are with by on at as or most not be from what true false this that patient year old'.split(' '));
const words = t => new Set(normT(t).split(' ').filter(x => x.length > 2 && !STOPW.has(x)));
const jac = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / Math.max(1, a.size + b.size - i) };
const istDay = (k = 0) => new Date(Date.now() + 5.5 * 3600e3 + k * 864e5).toISOString().slice(0, 10);

const nD = +(process.argv[2] || 50), nF = +(process.argv[3] || 25);
const drafts = readJ(path.join(DIR, 'ai-drafts.json'), {});
const bank = readJ(path.join(DIR, 'questions.json'), { raw: [] }).raw.map((r, i) => ({ id: 'b' + (i + 1), topic: TOPICS[r[0]], q: r[2], o: r[3], a: r[4], e: r[5] }));
const mine = readJ(path.join(DIR, 'my-questions.json'), { items: [] });
const all = bank.concat(mine.items || []); const W = all.map(q => words(q.q + ' ' + q.o.join(' ')));
const today = istDay().replace(/-/g, ''), todayCount = (mine.items || []).filter(q => String(q.id).startsWith('cai' + today + '_')).length;

const D = (drafts.pending || []).slice(0, nD), F = (drafts.pendingFlags || []).slice(0, nF);
const similar = q => { const w = words(q.q + ' ' + q.o.join(' ')); return W.map((x, i) => [jac(w, x), i]).sort((a, b) => b[0] - a[0]).slice(0, 2).filter(x => x[0] >= 0.25).map(([s, i]) => `${Math.round(s * 100)}% ${all[i].id}: ${all[i].q.slice(0, 110)}`) };

// top-up targets: today's and the next 3 days of the timetable
const plan = readJ(path.join(DIR, 'plan-topics.json'), { days: [] }), targets = [];
for (let k = 0; k <= 3; k++) { const d = plan.days.find(x => x.d === istDay(k)); if (!d) continue;
  if (d.type === 'study') d.read.forEach(r => targets.push(d.topics[0] + ' / ' + r)); else d.topics.forEach(t => targets.push(t + ' / all subtopics')) }

let md = `# Review sheet ${istDay()}  (published today so far: ${todayCount}; target 100)\n\n`;
md += `## Drafts (${D.length} of ${(drafts.pending || []).length} waiting)\n`;
D.forEach(q => { md += `\n### ${q.id} [${q.topic}]\n${q.q}\n${q.o.map((o, k) => `${L[k]}. ${o}`).join('\n')}\nKey: ${L[q.a]} | ${q.e || ''}\n`; const s = similar(q); if (s.length) md += `Similar existing: ${s.join(' || ')}\n` });
md += `\n## Proofreading flags (${F.length})\n`;
F.forEach(f => { const q = all.find(x => x.id === f.id); if (!q) { md += `\n### ${f.id}: question no longer exists (discard)\n`; return }
  md += `\n### ${f.id} [${q.topic}]\n${q.q}\n${q.o.map((o, k) => `${L[k]}. ${o}`).join('\n')}\nMarked: ${L[q.a]} | ${q.e || ''}\nFree AI says: ${f.issue || ''}${f.sug ? ' Suggests: ' + f.sug : ''}\n` });
md += `\n## Top-up topics (write only if today is still under 100 after the drafts)\n${targets.join('\n') || 'any topic'}\n`;
fs.mkdirSync(RV, { recursive: true });
fs.writeFileSync(path.join(RV, 'input.md'), md);
fs.writeFileSync(path.join(RV, 'input.json'), JSON.stringify({ day: istDay(), todayCount, drafts: D.map(q => q.id), flags: F.map(f => f.id) }));
console.log(`review/input.md: ${D.length} drafts, ${F.length} flags, published today ${todayCount}. ${(drafts.pending || []).length - D.length} more drafts waiting.`);
