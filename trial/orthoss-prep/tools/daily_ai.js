// Ortho preSSaleel daily AI job, run by GitHub Actions on a schedule (no phone needed).
//   node daily_ai.js run    -> writes out/new-items.json, out/flags.json, out/state.json
//   node daily_ai.js apply  -> adds them to ai-drafts.json (pending) for Claude's morning review; updates ai-state.json
// Uses the free Pollinations text API (no key). New questions are kept only when two
// independent answers from the AI agree with the intended key; proofreading flags a
// question only when an independent second answer also disagrees with the marked key.
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..'), OUT = path.join(process.cwd(), 'out');
let N_NEW = +(process.env.DAILY_NEW || 100), N_PROOF = +(process.env.DAILY_PROOF || 100);
// If Claude's review is behind (e.g. usage limit reached), stop adding to the backlog once it is this large.
const MAX_PENDING = 600, MAX_PENDING_FLAGS = 300;
const MAX_MIN = +(process.env.MAX_MINUTES || 100), T0 = Date.now();
const L = 'ABCD';
const TOPICS = ["Trauma","Spine","Arthroplasty","Sports & Arthroscopy","Paediatric Ortho","Hand & Upper Limb","Foot & Ankle","Oncology","Basic Sciences","Infection & Metabolic"];
const SUBT = {"Trauma":["pelvis and acetabulum","hip and femoral fractures","tibial plateau and pilon","ankle fractures","proximal humerus and shoulder girdle","elbow and forearm","distal radius and carpus","polytrauma, open fractures and compartment syndrome","fracture healing and fixation principles"],
 "Spine":["cervical trauma","thoracolumbar trauma","degenerative cervical myelopathy","lumbar disc and stenosis","scoliosis and deformity","spinal tuberculosis and infection","spinal tumours and metastases","spinopelvic alignment"],
 "Arthroplasty":["THA approaches and complications","TKA balancing and alignment","periprosthetic infection (ICM criteria)","bearing surfaces and wear","revision arthroplasty","shoulder arthroplasty","unicompartmental knee arthroplasty and osteotomy"],
 "Sports & Arthroscopy":["ACL and PCL","menisci and cartilage","patellofemoral instability","shoulder instability","rotator cuff","hip arthroscopy and FAI","elbow in throwers","sports medicine and anti-doping"],
 "Paediatric Ortho":["DDH","Perthes and SCFE","clubfoot and foot deformities","paediatric fractures","cerebral palsy and neuromuscular disorders","skeletal dysplasias","bone and joint infection in children"],
 "Hand & Upper Limb":["flexor and extensor tendons","nerve compression and injury","brachial plexus","carpal instability and scaphoid","hand infections","congenital hand","Dupuytren and rheumatoid hand"],
 "Foot & Ankle":["hallux valgus and forefoot","flatfoot and cavus foot","Achilles and tendons","diabetic foot and Charcot","ankle arthritis and instability","talus and calcaneus"],
 "Oncology":["bone-forming tumours","cartilage tumours","giant cell and cystic lesions","small round cell tumours","soft-tissue sarcoma","metastatic bone disease","biopsy and staging"],
 "Basic Sciences":["bone biology","cartilage and synovium","biomechanics and biomaterials","nerve and muscle","statistics and evidence","imaging physics","pharmacology and perioperative care"],
 "Infection & Metabolic":["osteomyelitis and septic arthritis","tuberculosis","rickets and osteomalacia","osteoporosis drugs","crystal arthropathy","Paget and metabolic bone disease","osteonecrosis"]};
const STD = {"INI-SS":"INI-SS (AIIMS-run MCh entrance: MCh Joint Replacement, MCh Sports Medicine, MCh Hand Surgery). Difficult single-best-answer questions; many clinical vignettes; recent advances, named signs, classifications, implant and surgical-technique details; options that are all plausible.",
 "NEET-SS":"NEET-SS (MCh/DrNB Orthopaedics entrance). Clinically oriented single-best-answer questions across all orthopaedics; management decisions, investigations of choice, classifications, complications, eponyms.",
 "FNB":"FNB / FET (NBEMS fellowship entrance in arthroplasty, spine, sports, hand, trauma, paediatric orthopaedics). Subspecialty-depth recall and decision questions; classifications, indications, surgical approaches, implant biomechanics, landmark trials."};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const timeLeft = (reserve = 0) => (Date.now() - T0) / 60000 < MAX_MIN - reserve;
const shuf = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a };
const normT = t => String(t || '').toLowerCase().replace(/<[^>]+>/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const STOPW = new Set('the of a an is in to and for which following all except are with by on at as or most not be from what true false'.split(' '));
const qSig = (q, o) => { const t = normT(q); return { t, w: new Set(t.split(' ').filter(x => x.length > 1 && !STOPW.has(x))), o: new Set((o || []).map(normT).filter(Boolean)) } };
const jac = (a, b) => { if (!a.size && !b.size) return 1; let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i) };
const sameQ = (a, b) => { let ov = 0; for (const x of a.o) if (b.o.has(x)) ov++; const j = a.t === b.t ? 1 : jac(a.w, b.w);
  return (ov >= 3 && j >= 0.8) || (ov >= 2 && j >= 0.95 && a.w.size >= 5) || (a.t === b.t && a.t.length > 40 && ov >= 2) };
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { return d } };

const AI_MODEL = process.env.AI_MODEL || 'openai';
let lastCall = 0;
const LADDER = ['high', 'medium', 'low'];
async function ai(prompt, effort) {
  let lvl = Math.max(0, LADDER.indexOf(effort || 'low'));
  for (let attempt = 0; attempt < 5; attempt++) {
    effort = LADDER[lvl];
    const wait = 47000 - (Date.now() - lastCall); if (wait > 0) await sleep(wait);
    try {
      const r = await fetch('https://text.pollinations.ai/openai', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.assign({ model: AI_MODEL, messages: [{ role: 'user', content: prompt }], max_tokens: 16000, referrer: 'ortho-presaleel' }, AI_MODEL === 'openai' ? { reasoning_effort: effort || 'low' } : {})),
        signal: AbortSignal.timeout(240000) });
      lastCall = Date.now();
      if (r.status === 400 && lvl < 2) { const b = await r.text().catch(() => ''); if (/token limit|reasoning effort/i.test(b)) { console.log('  answer too long at ' + effort + ' effort, retrying lower'); lvl++; attempt--; continue } }
      if (!r.ok) { const b = await r.text().catch(() => ''); const m = /Retry after (\d+)s/.exec(b); if (m) await sleep((+m[1] + 3) * 1000); throw new Error('HTTP ' + r.status + ' ' + b.slice(0, 160)) }
      const j = await r.json(); const t = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (!t) throw new Error('empty');
      return t;
    } catch (e) { lastCall = Date.now(); console.log('  AI call failed:', e.message); await sleep(5000 * (attempt + 1)) }
  }
  throw new Error('AI unavailable');
}
function arr(t) {
  t = String(t || '');
  try { const v = JSON.parse(t); return Array.isArray(v) ? v : [] } catch (e) {}
  const i = t.indexOf('['), j = t.lastIndexOf(']'); if (i >= 0 && j > i) { try { return JSON.parse(t.slice(i, j + 1)) } catch (e) {} }
  const out = []; const re = /\{[^{}]*\}/g; let m; while ((m = re.exec(t))) { try { out.push(JSON.parse(m[0])) } catch (e) {} } return out;
}
const fmt = (q, i, key) => `${i}. ${q.q}\nA. ${q.o[0]}\nB. ${q.o[1]}\nC. ${q.o[2]}\nD. ${q.o[3]}` + (key ? `\nMarked answer: ${L[q.a]}\nExplanation: ${q.e || '-'}` : '');
const answerPrompt = qs => `You are an expert orthopaedic examiner. Answer each question independently with the single best option. If a question is ambiguous, has two defensible answers or contains a factual error, mark it "bad".
${qs.map((q, i) => fmt(q, i + 1, false)).join('\n\n')}
Reply with only a JSON array, one object per question: [{"i":1,"a":0,"bad":false}] where "a" is the 0-based index of the correct option.`;


// Topics for tonight's drafts: today's and the next 3 days of the NEET-SS timetable (plan-topics.json), so the reviewed
// questions arrive while that topic is being studied. Falls back to rotating through all subtopics.
function planTargets() {
  const plan = readJ(path.join(DIR, 'plan-topics.json'), null);
  const ist = new Date(Date.now() + 5.5 * 3600e3); const day = k => new Date(ist.getTime() + k * 864e5).toISOString().slice(0, 10);
  const out = [];
  if (plan && Array.isArray(plan.days)) for (let k = 0; k <= 3; k++) { const d = plan.days.find(x => x.d === day(k)); if (!d) continue;
    if (d.type === 'study') d.read.forEach(r => out.push({ topic: d.topics[0], sub: r }));
    else d.topics.forEach(t => (SUBT[t] || [t]).forEach(r => out.push({ topic: t, sub: r }))) }
  if (out.length) return out;
  const dnum = Math.floor(Date.now() / 864e5); const all = []; TOPICS.forEach(t => SUBT[t].forEach(r => all.push({ topic: t, sub: r })));
  return Array.from({ length: 12 }, (_, i) => all[(dnum * 12 + i) % all.length]);
}
// Recalled questions for this area: previous-paper recalls in the bank (set) and the developer's recall uploads, best-matching subtopic first.
function recallFor(bank, custom, topic, sub) {
  const words = normT(sub).split(' ').filter(w => w.length > 3 && !STOPW.has(w));
  const pool = bank.filter(q => q.set && q.topic === topic).concat(custom.filter(q => q.topic === topic && /recall|pyq/i.test((q.src || '') + ' ' + (q.kind || '') + ' ' + (q.set || ''))));
  const score = q => { const t = normT(q.q + ' ' + (q.e || '')); return words.reduce((a, w) => a + (t.includes(w) ? 1 : 0), 0) + Math.random() * 0.5 };
  const ranked = pool.map(q => [score(q), q]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
  return ranked.length >= 3 ? ranked : ranked.concat(shuf(bank.filter(q => q.set)).slice(0, 5));
}

// High-yield notes written for the app (notes/<topic>.json); used as the factual source for tonight's questions.
function notesFor(topic, sub) {
  const f = path.join(DIR, 'notes', topic.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.json'), d = readJ(f, null);
  const n = d && d.subs && d.subs[sub]; return n && n.md ? String(n.md).slice(0, 7000) : '';
}
function loadAll() {
  const bank = readJ(path.join(DIR, 'questions.json'), { raw: [] }).raw.map((r, i) => ({ id: 'b' + (i + 1), topic: TOPICS[r[0]], q: r[2], o: r[3], a: r[4], e: r[5], set: r[7] || '' }));
  const mine = readJ(path.join(DIR, 'my-questions.json'), { items: [], deleted: [], overrides: {} });
  const del = new Set(mine.deleted || []);
  const custom = (mine.items || []).filter(q => q && !del.has(q.id) && Array.isArray(q.o) && q.o.length === 4);
  return { bank, custom, all: bank.concat(custom), mine };
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const { bank, custom, all } = loadAll();
  const state = readJ(path.join(DIR, 'ai-state.json'), { pidx: 0, runs: [] });
  const drafts = readJ(path.join(DIR, 'ai-drafts.json'), {});
  const backlog = (drafts.pending || []).length, flagBacklog = (drafts.pendingFlags || []).length;
  if (backlog >= MAX_PENDING) { console.log(`Review backlog is ${backlog} questions; not writing new drafts tonight.`); N_NEW = 0 }
  if (flagBacklog >= MAX_PENDING_FLAGS) { console.log(`Review backlog is ${flagBacklog} flags; not proofreading tonight.`); N_PROOF = 0 }
  const sigs = all.concat(drafts.pending || [], drafts.items || []).map(q => qSig(q.q, q.o));
  const today = new Date().toISOString().slice(0, 10), dnum = Math.floor(Date.now() / 864e5);
  const newItems = [], flags = [];
  console.log(`Bank ${bank.length} + added ${custom.length}. Target ${N_NEW} new, ${N_PROOF} proofread.`);

  // 1. New questions
  let batch = 0, genFails = 0, proofFails = 0;
  const targets = planTargets();
  console.log('Topics from the NEET-SS timetable: ' + targets.map(t => t.topic + ' / ' + t.sub).join('; '));
  while (newItems.length < N_NEW && batch < 45 && timeLeft(Math.min(30, Math.ceil(N_PROOF / 4)))) {
    const tg = targets[batch % targets.length], topic = tg.topic, sub = tg.sub;
    const exam = ['NEET-SS', 'NEET-SS', 'FNB', 'NEET-SS', 'INI-SS'][batch % 5]; batch++;
    const recall = recallFor(bank, custom, topic, sub);
    const ex = recall.slice(0, 5);
    const avoid = shuf(all.filter(q => q.topic === topic).map(q => q.q.slice(0, 70))).slice(0, 20);
    const notes = notesFor(topic, sub);
    try {
      const gen = arr(await ai(`You write original single-best-answer MCQs for Indian orthopaedic superspeciality entrance exams. Target: ${STD[exam]}
Write exactly 6 new questions on ${topic}, focusing on ${sub}.${notes ? `
- SOURCE NOTES (checked by an orthopaedic reviewer). Build every question on facts stated in these notes; do not add facts that are not in them:
<<<
${notes}
>>>` : ''}
- Test established knowledge found in standard orthopaedic references (such as Campbell's Operative Orthopaedics, Rockwood and Green, AAOS Comprehensive Orthopaedic Review, Miller's Review) and widely accepted consensus statements, guidelines and classifications. Include recent consensus only if you are confident it is accurate.
- Include only facts you are confident are correct and generally agreed. If a fact is debated or varies between sources, do not use it.
- Write in your own words; do not copy sentences from any book or question bank.
- These are REAL recalled questions from previous NEET-SS / FET / INI-SS papers on this area. Examiners repeat the same high-yield facts year after year, often rephrased. Write questions that (1) test the same facts these recalls test, asked from a different angle or as a clinical vignette, and (2) test the closely related facts examiners usually pair with them (the other types in the same classification, the next step in management, the commonest complication, the investigation of choice). Match their style and difficulty:
${ex.map((q, i) => fmt(q, i + 1, true)).join('\n\n')}
- Do not repeat these existing questions: ${avoid.join(' | ')}
- Mix clinical vignettes (about 40%), one-line recall ("Most common…", "Investigation of choice…", "…is classified as"), "All of the following EXCEPT" and statement questions.
- Exactly 4 options, one clearly correct; distractors from the same category; no "all/none of the above"; vary the correct letter.
- "e" explains in 1-3 sentences why the answer is right.
Reply with only a JSON array: [{"q":"...","o":["A","B","C","D"],"a":0,"e":"..."}]`, 'low'))
        .filter(x => x && typeof x.q === 'string' && Array.isArray(x.o) && x.o.length === 4 && +x.a >= 0 && +x.a < 4)
        .map(x => ({ q: x.q.trim(), o: x.o.map(o => String(o).replace(/^\s*(?:\(?[A-Ea-e][.)]\s+)+/, '').trim()), a: +x.a, e: String(x.e || '').trim() }))
        .filter(x => new Set(x.o.map(normT)).size === 4 && x.q.length > 15);
      if (!gen.length) continue;
      // two independent answer passes; keep only questions where both agree with the intended key
      const v1 = new Map(arr(await ai(answerPrompt(gen), 'low')).map(c => [+c.i, c]));
      const order2 = [];
      let kept = 0;
      for (let i = 0; i < gen.length; i++) {
        const x = gen[i], c1 = v1.get(i + 1);
        if (!c1 || c1.bad || +c1.a !== x.a) continue;
        const sg = qSig(x.q, x.o); if (sigs.some(s => sameQ(sg, s))) continue;
        order2.push(x);
      }
      if (order2.length) {
        // second pass sees the surviving questions with their options in a different order, so agreement isn't just positional
        const perm = order2.map(x => { const idx = shuf([0, 1, 2, 3]); return { q: x.q, o: idx.map(k => x.o[k]), map: idx } });
        const c2 = new Map(arr(await ai(answerPrompt(perm), 'low')).map(c => [+c.i, c]));
        order2.forEach((x, k) => {
          const c = c2.get(k + 1); if (!c || c.bad || !(+c.a >= 0 && +c.a < 4) || perm[k].map[+c.a] !== x.a) return;
          const sg = qSig(x.q, x.o); if (sigs.some(s => sameQ(sg, s))) return;
          sigs.push(sg); kept++;
          newItems.push({ id: 'ai' + today.replace(/-/g, '') + '_' + String(newItems.length + 1).padStart(3, '0'), topic, kind: 'AI-daily', q: x.q, o: x.o, a: x.a, e: x.e, src: 'Exam-style', exam, year: '', fresh: true, proofed: true });
        });
      }
      console.log(`  ${topic} / ${sub} (${exam}): kept ${kept} of ${gen.length}`);
    } catch (e) { console.log('  batch failed:', e.message); if (/unavailable/.test(e.message) && ++genFails >= 3) break }
  }

  // 2. Proofreading (whole bank in rotation, plus any added questions not yet proofread)
  const fresh = custom.filter(q => !q.proofed);
  const queue = fresh.concat(Array.from({ length: all.length }, (_, k) => all[(state.pidx + k) % all.length]));
  let done = 0, pi = 0;
  while (done < N_PROOF && pi < queue.length && timeLeft()) {
    const b = queue.slice(pi, pi + 8); pi += 8;
    try {
      const res = arr(await ai(`You are proofreading an orthopaedic superspeciality exam question bank. For each item decide whether the marked answer is correct and whether the question, options or explanation contain a clear factual error, internal contradiction or ambiguity (two defensible answers). Be conservative: flag only clear problems, not style.
${b.map((q, i) => fmt(q, i + 1, true)).join('\n\n')}
Reply with only a JSON array, one object per item: [{"i":1,"ok":true,"correct":null,"issue":""}] where "correct" is the 0-based index of the right option if the marked answer is wrong, otherwise null, and "issue" briefly states the problem.`, 'low'));
      const fl = [];
      for (const r of res) { const q = b[+r.i - 1]; if (!q || r.ok !== false) continue; const c = r.correct == null ? null : +r.correct;
        fl.push({ q, sug: c != null && c >= 0 && c < 4 && c !== q.a ? q.o[c] : null, issue: String(r.issue || '').slice(0, 300) }) }
      if (fl.length) {
        const sec = new Map(arr(await ai(answerPrompt(fl.map(f => f.q)), 'low')).map(c => [+c.i, c]));
        fl.forEach((f, i) => { const c = sec.get(i + 1); const second = c && +c.a >= 0 && +c.a < 4 ? f.q.o[+c.a] : null;
          const strong = second != null && second !== f.q.o[f.q.a];
          if (strong || (!f.sug && f.issue)) flags.push({ id: f.q.id, q: f.q.q.slice(0, 200), key: f.q.o[f.q.a], sug: f.sug || (strong ? second : null), second, issue: f.issue, strong, day: today, t: Date.now() }) });
      }
      done += b.length;
    } catch (e) { console.log('  proof batch failed:', e.message); if (/unavailable/.test(e.message) && ++proofFails >= 3) break }
  }
  const proofedIds = queue.slice(0, pi).map(q => q.id);
  const rotated = Math.max(0, Math.min(pi, queue.length) - fresh.length);
  const st = { pidx: (state.pidx + rotated) % Math.max(1, all.length), last: { day: today, at: new Date().toISOString(), made: newItems.length, proofread: done, flagged: flags.length, minutes: Math.round((Date.now() - T0) / 60000) } };
  fs.writeFileSync(path.join(OUT, 'new-items.json'), JSON.stringify(newItems));
  fs.writeFileSync(path.join(OUT, 'flags.json'), JSON.stringify(flags));
  fs.writeFileSync(path.join(OUT, 'state.json'), JSON.stringify(Object.assign(st, { proofedIds })));
  console.log(`Done: ${newItems.length} new questions, ${done} proofread, ${flags.length} flagged, ${st.last.minutes} min.`);
}

function apply() {
  // Nothing goes straight to the app: new questions and suspected errors wait in ai-drafts.json
  // until Claude's morning review corrects or rejects them and publishes the good ones.
  const items = readJ(path.join(OUT, 'new-items.json'), []), flags = readJ(path.join(OUT, 'flags.json'), []), st = readJ(path.join(OUT, 'state.json'), null);
  const df = path.join(DIR, 'ai-drafts.json'), d = readJ(df, {});
  d.pending = d.pending || []; d.pendingFlags = d.pendingFlags || [];
  const have = new Set(d.pending.map(q => q.id)); let added = 0;
  items.forEach(q => { if (!have.has(q.id)) { d.pending.push(q); added++ } });
  const seen = new Set(d.pendingFlags.map(f => f.id + '|' + f.key));
  flags.forEach(f => { if (!seen.has(f.id + '|' + f.key)) d.pendingFlags.push(f) });
  d.updated = new Date().toISOString();
  fs.writeFileSync(df, JSON.stringify(d, null, 1));
  // Keep each night's drafts, unreviewed, so the developer can see them in the app before Claude's review.
  if (items.length) {
    const day = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10), dd = path.join(DIR, 'drafts'); fs.mkdirSync(dd, { recursive: true });
    const f = path.join(dd, day + '.json'), cur = readJ(f, { day, items: [] }), ids = new Set(cur.items.map(q => q.id));
    items.forEach(q => { if (!ids.has(q.id)) cur.items.push(Object.assign({}, q, { status: 'waiting' })) });
    fs.writeFileSync(f, JSON.stringify(cur));
    const idxF = path.join(dd, 'index.json'), idx = readJ(idxF, { days: [] });
    idx.days = [{ day, n: cur.items.length }].concat(idx.days.filter(x => x.day !== day)).sort((a, b) => a.day < b.day ? 1 : -1).slice(0, 30);
    fs.writeFileSync(idxF, JSON.stringify(idx));
  }
  if (st) { const sf = path.join(DIR, 'ai-state.json'), old = readJ(sf, { runs: [] });
    fs.writeFileSync(sf, JSON.stringify({ pidx: st.pidx, last: Object.assign({}, st.last, { pendingReview: true }), runs: [st.last].concat(old.runs || []).slice(0, 30) })) }
  console.log(`Queued for Claude review: ${added} new questions, ${flags.length} flags.`);
}

(process.argv[2] === 'apply' ? Promise.resolve(apply()) : run()).catch(e => { console.error(e); process.exit(1) });
