// Collects the developer's signed question uploads from the ntfy.sh relay and merges them into my-questions.json.
// Only messages signed with the developer's private key (unlocked on the phone with the developer password) are accepted.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const DIR = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(DIR, 'relay.json'), 'utf8'));
const stF = path.join(DIR, 'relay-state.json'), mqF = path.join(DIR, 'my-questions.json');
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { return d } };
const pub = crypto.createPublicKey({ key: cfg.pub, format: 'jwk' });

function verify(p, s) {
  try { return crypto.verify('sha256', Buffer.from(p, 'utf8'), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64')) } catch (e) { return false }
}
function okItem(q) { return q && typeof q.id === 'string' && typeof q.q === 'string' && Array.isArray(q.o) && q.o.length === 4 && q.o.every(o => typeof o === 'string') && Number.isInteger(+q.a) && +q.a >= 0 && +q.a < 4 }

(async () => {
  const st = readJ(stF, { seen: [] });
  const url = `https://ntfy.sh/${cfg.topic}/json?poll=1&since=12h`;
  const r = await fetch(url); if (!r.ok) throw new Error('relay HTTP ' + r.status);
  const msgs = (await r.text()).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch (e) { return null } }).filter(m => m && m.event === 'message');
  const seen = new Set(st.seen || []); const mine = readJ(mqF, { items: [], deleted: [], overrides: {} });
  mine.deleted = mine.deleted || []; mine.overrides = mine.overrides || {};
  let added = 0, removed = 0, ovr = 0, accepted = 0, rejected = 0;
  for (const m of msgs) {
    if (seen.has(m.id)) continue; seen.add(m.id);
    let body = m.message;
    if (m.attachment && m.attachment.url) { try { const a = await fetch(m.attachment.url); if (!a.ok) { seen.delete(m.id); continue } body = await a.text() } catch (e) { seen.delete(m.id); continue } }
    let env; try { env = JSON.parse(body) } catch (e) { rejected++; continue }
    if (!env || typeof env.p !== 'string' || typeof env.s !== 'string' || !verify(env.p, env.s)) { rejected++; continue }
    let pl; try { pl = JSON.parse(env.p) } catch (e) { rejected++; continue }
    if (!pl || pl.v !== 1 || seen.has('n:' + pl.nonce)) continue; seen.add('n:' + pl.nonce);
    accepted++;
    const ops = pl.ops || {}, del = new Set(mine.deleted);
    for (const id of ops.deleted || []) if (typeof id === 'string' && !del.has(id)) { del.add(id); removed++ }
    mine.deleted = [...del];
    const have = new Set(mine.items.map(q => q.id));
    for (const q of ops.items || []) if (okItem(q) && !have.has(q.id) && !del.has(q.id)) { mine.items.push(q); have.add(q.id); added++ }
    mine.items = mine.items.filter(q => !del.has(q.id));
    for (const [id, v] of Object.entries(ops.overrides || {})) if (v && typeof v === 'object' && (!mine.overrides[id] || (v.t || 0) > (mine.overrides[id].t || 0))) { mine.overrides[id] = v; ovr++ }
  }
  st.seen = [...seen].slice(-2000); st.last = new Date().toISOString();
  if (added || removed || ovr) { mine.updated = new Date().toISOString(); fs.writeFileSync(mqF, JSON.stringify(mine)) }
  fs.writeFileSync(stF, JSON.stringify(st));
  console.log(`Relay: ${msgs.length} messages, ${accepted} accepted, ${rejected} rejected; +${added} questions, -${removed}, ${ovr} corrections.`);
  fs.writeFileSync(path.join(DIR, '.relay-changed'), added || removed || ovr ? '1' : '');
})().catch(e => { console.error(e); process.exit(1) });
