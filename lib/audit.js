// lib/audit.js - the audit log and the daily counters behind the stats page
const FIELDS = new Set(['signups', 'messages', 'verified', 'beta_grants', 'reports', 'appeals', 'bans']);   // allowed counter columns
const seen = new Set();                                      // users already counted as active today (keeps the db quiet)
let seenDay = '';

// who did what to whom. names are copied in so the log still reads fine after an account is deleted
async function log(q, actor, action, target, extra = {}) {
  try {
    await q('insert into audit(actor_id,actor_name,action,target_id,target_name,conv_id,conv_name,detail) values($1,$2,$3,$4,$5,$6,$7,$8)', [
      (actor && actor.id) || null, actor ? actor.username || actor.name || 'system' : 'system', action,
      (target && target.id) || null, target ? target.username || target.name || null : null,
      extra.convId || null, extra.convName || null, extra.detail ? String(extra.detail).slice(0, 300) : null]);
  } catch (e) { console.error('audit failed', e.message); }
}
// add one (or n) to a counter for today
function bump(q, field, n = 1) {
  if (!FIELDS.has(field)) return;
  q(`insert into daily_stats(day,${field}) values(current_date,$1) on conflict(day) do update set ${field}=daily_stats.${field}+$1`, [n]).catch(() => {});
}
// mark a user as active today, once per process per day
function touchDay(q, userId) {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== seenDay) { seen.clear(); seenDay = d; }
  if (seen.has(userId)) return;
  seen.add(userId);
  q('insert into user_days(day,user_id) values(current_date,$1) on conflict do nothing', [userId]).catch(() => {});
}
module.exports = { log, bump, touchDay };
