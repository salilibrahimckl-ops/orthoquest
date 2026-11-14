// Rebuilds notes/index.json from the notes/<topic>.json files, and optionally merges new notes in.
//   node notes_index.js [file-with-{topic,subs}.js|json ...]
// Each notes/<topic>.json is {topic, subs:{ "<subtopic exactly as in the timetable>": {md, updated, by} }}.
const fs = require('fs'), path = require('path');
const ND = path.join(__dirname, '..', 'notes'); fs.mkdirSync(ND, { recursive: true });
const slug = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const day = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
for (const f of process.argv.slice(2)) {
  const src = f.endsWith('.js') ? require(path.resolve(f)) : JSON.parse(fs.readFileSync(f, 'utf8'));
  const p = path.join(ND, slug(src.topic) + '.json'); let cur = { topic: src.topic, subs: {} };
  try { cur = JSON.parse(fs.readFileSync(p, 'utf8')) } catch (e) {}
  for (const [k, v] of Object.entries(src.subs)) { const md = typeof v === 'string' ? v : v.md; if (!md || md.length < 200) throw new Error('note too short: ' + k);
    cur.subs[k] = { md, updated: day, by: 'Claude' } }
  fs.writeFileSync(p, JSON.stringify(cur));
}
const idx = { updated: day, topics: {} };
for (const f of fs.readdirSync(ND).filter(x => x.endsWith('.json') && x !== 'index.json')) {
  const d = JSON.parse(fs.readFileSync(path.join(ND, f), 'utf8')); idx.topics[d.topic] = { file: f, subs: Object.keys(d.subs) } }
fs.writeFileSync(path.join(ND, 'index.json'), JSON.stringify(idx));
console.log('notes:', Object.entries(idx.topics).map(([t, v]) => t + ' ' + v.subs.length).join(', '));
