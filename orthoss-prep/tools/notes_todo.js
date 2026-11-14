// Lists timetable subtopics that still need high-yield notes, most urgent first:
// today's and upcoming study days, then earlier days (needed for the revision rounds).
//   node notes_todo.js [n=5]
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..');
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { return d } };
const plan = readJ(path.join(DIR, 'plan-topics.json'), { days: [] }), idx = readJ(path.join(DIR, 'notes', 'index.json'), { topics: {} });
const have = new Set(Object.entries(idx.topics || {}).flatMap(([t, v]) => v.subs.map(s => t + '|' + s)));
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const study = plan.days.filter(d => d.type === 'study').flatMap(d => d.read.map(r => ({ d: d.d, topic: d.topics[0], sub: r })));
const todo = study.filter(x => x.d >= today).concat(study.filter(x => x.d < today)).filter(x => !have.has(x.topic + '|' + x.sub));
const n = +(process.argv[2] || 5);
console.log(`${todo.length} subtopics still need notes.` + (todo.length ? ' Next:' : ' All done.'));
todo.slice(0, n).forEach(x => console.log(`${x.d} | ${x.topic} | ${x.sub}`));
