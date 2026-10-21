// lib/limiter.js - in-memory rate limiting (sliding window + escalating mutes for spammers)
// note: state lives in this process, so run a single replica (or swap this for redis if you scale out)

class Limiter {
  constructor() {
    this.hits = new Map();     // key -> { arr: number[] (timestamps), win: number (window ms) }
    this.strikes = new Map();  // key -> { count, first, muteUntil, level }
    // sweep old entries every minute so memory never grows forever
    setInterval(() => this.sweep(), 60_000).unref();
  }

  // record a hit for `key`; allow at most `max` hits per `windowMs`
  hit(key, max, windowMs) {
    const now = Date.now();                                  // current time
    let e = this.hits.get(key);                              // existing bucket for this key
    if (!e) { e = { arr: [], win: windowMs }; this.hits.set(key, e); } // make a new bucket if none
    e.win = Math.max(e.win, windowMs);                       // remember the longest window used for sweeping
    while (e.arr.length && e.arr[0] <= now - windowMs) e.arr.shift(); // drop hits older than the window
    if (e.arr.length >= max) {                               // over the limit
      const retryAfter = Math.max(1, Math.ceil((e.arr[0] + windowMs - now) / 1000)); // seconds until oldest hit expires
      return { ok: false, retryAfter };
    }
    e.arr.push(now);                                         // count this hit
    return { ok: true, retryAfter: 0 };
  }

  // seconds left on an active mute for `key` (0 = not muted)
  muted(key) {
    const s = this.strikes.get(key);
    if (!s || !s.muteUntil) return 0;
    const left = Math.ceil((s.muteUntil - Date.now()) / 1000);
    return left > 0 ? left : 0;
  }

  // record a violation; 5 strikes inside 2 minutes => temp mute that gets longer each time
  strike(key) {
    const now = Date.now();
    let s = this.strikes.get(key);
    if (!s) { s = { count: 0, first: now, muteUntil: 0, level: 0 }; this.strikes.set(key, s); }
    if (now - s.first > 120_000) { s.count = 0; s.first = now; } // strikes expire after 2 minutes
    s.count++;
    if (s.count >= 5) {                                      // too many violations
      const steps = [30, 120, 600, 1800];                    // mute lengths in seconds: 30s, 2m, 10m, 30m
      const secs = steps[Math.min(s.level, steps.length - 1)];
      s.muteUntil = now + secs * 1000;                       // start the mute
      s.level++;                                             // next time it is longer
      s.count = 0; s.first = now;
      return secs;
    }
    return 0;
  }

  // remove stale data
  sweep() {
    const now = Date.now();
    for (const [k, e] of this.hits) {                        // drop buckets with no recent hits
      if (!e.arr.length || e.arr[e.arr.length - 1] <= now - e.win) this.hits.delete(k);
    }
    for (const [k, s] of this.strikes) {                     // drop strike records that are fully expired
      if (s.muteUntil < now && now - s.first > 600_000 && now - s.muteUntil > 3_600_000) this.strikes.delete(k);
    }
  }
}

const limiter = new Limiter();

// express middleware factory: rl('login', 10, 600000, req => req.ip)
function rl(name, max, windowMs, keyFn) {
  return (req, res, next) => {
    const key = `${name}:${keyFn ? keyFn(req) : req.ip}`;    // bucket key = rule name + who
    const r = limiter.hit(key, max, windowMs);
    if (r.ok) return next();
    res.set('Retry-After', String(r.retryAfter));            // tell clients when to retry
    return res.status(429).json({ error: 'rate_limited', retryAfter: r.retryAfter, rule: name });
  };
}

module.exports = { limiter, rl };
