// Lists existing question stems for a topic that match a keyword regex, so a writer can avoid duplicates.
//   node bulk_stems.js "Trauma" "ankle|malleol|syndesm|weber|lauge"
const fs = require('fs'), path = require('path'), DIR = path.join(__dirname, '..');
const TOPICS = ["Trauma","Spine","Arthroplasty","Sports & Arthroscopy","Paediatric Ortho","Hand & Upper Limb","Foot & Ankle","Oncology","Basic Sciences","Infection & Metabolic"];
const [topic, re] = process.argv.slice(2); const R = new RegExp(re || '.', 'i');
const bank = JSON.parse(fs.readFileSync(path.join(DIR, 'questions.json'))).raw.map(r => ({ topic: TOPICS[r[0]], q: r[2], k: r[3][r[4]] }));
const mine = JSON.parse(fs.readFileSync(path.join(DIR, 'my-questions.json'))).items.map(q => ({ topic: q.topic, q: q.q, k: q.o[q.a] }));
const hits = bank.concat(mine).filter(q => (!topic || q.topic === topic) && R.test(q.q + ' ' + q.k));
hits.forEach(q => console.log('- ' + q.q.replace(/\s+/g, ' ').slice(0, 150) + ' => ' + String(q.k).slice(0, 50)));
console.log(hits.length + ' existing');
