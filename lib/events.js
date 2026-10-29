// lib/events.js - timed global events the owner starts from the console (they switch themselves off when the time is up)
const crypto = require('crypto');                            // short event ids

const KINDS = {                                              // what an event can change, and the limits on its value
  refbonus: { label: 'beta minutes per referred friend', min: 1, max: 1440 },
  welcome: { label: 'free beta minutes for every newly verified account', min: 1, max: 1440 },
};
let list = [];                                               // every event, newest last

async function load(q) {                                     // read the saved list at boot
  try { const r = await q("select value from settings where key='events'"); list = r.rows[0] ? JSON.parse(r.rows[0].value) : []; } catch { list = []; }
}
const save = (q) => q("insert into settings(key,value) values('events',$1) on conflict(key) do update set value=$1", [JSON.stringify(list)]);
const alive = (e) => new Date(e.until) > new Date();         // not expired yet
const all = () => { list = list.filter(alive); return list; };   // drops expired ones as a side effect
const active = (kind) => all().find((e) => e.kind === kind) || null;
const value = (kind, dflt) => { const e = active(kind); return e ? e.value : dflt; };   // the event value, or the normal one

async function start(q, kind, val, mins, by) {
  const k = KINDS[kind];
  if (!k) return { error: 'unknown event kind, try: ' + Object.keys(KINDS).join(', ') };
  if (!(val >= k.min && val <= k.max)) return { error: `value must be ${k.min} to ${k.max}` };
  if (!(mins >= 1 && mins <= 60 * 24 * 30)) return { error: 'duration must be between 1 minute and 30 days' };
  list = all().filter((e) => e.kind !== kind);               // one event per kind, a new one replaces the old
  const e = { id: crypto.randomBytes(3).toString('hex'), kind, value: val, until: new Date(Date.now() + mins * 60_000).toISOString(), by };
  list.push(e);
  await save(q);
  return { event: e };
}
async function stop(q, id) {                                 // id, or 'all'
  const before = all().length;
  list = id === 'all' ? [] : all().filter((e) => e.id !== id && e.kind !== id);
  await save(q);
  return before - list.length;
}
module.exports = { KINDS, load, all, active, value, start, stop };
