// lib/db.js - postgres pool + schema
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,                // railway injects this via the postgres reference variable
  ssl: process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined, // only needed for public proxy urls
  max: 12,                                                   // connection cap
});
pool.on('error', (e) => console.error('pg pool error', e.message)); // never crash on idle client errors

const q = (text, params) => pool.query(text, params);        // tiny helper

const SCHEMA = `
create table if not exists settings(key text primary key, value text not null);

create table if not exists users(
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  display_name text not null,
  kdf_salt text not null,            -- salt for the client side password derivation (not secret)
  auth_salt text not null,           -- server side salt for hashing the derived auth secret
  auth_hash text not null,           -- scrypt(authSecret) - the real password never reaches the server
  public_key text not null,          -- ecdh p-256 public key (raw, base64)
  wrapped_priv text not null,        -- private key encrypted in the browser with a key only the password can derive
  wrapped_priv_iv text not null,
  share_activity boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists sessions(
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ua text
);
create index if not exists sessions_user_idx on sessions(user_id);

create table if not exists conversations(
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('dm','group')),
  name text,
  dm_key text unique,                -- "idA:idB" sorted, makes dms unique
  created_by uuid references users(id) on delete set null,
  key_version int not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists members(
  conv_id uuid not null references conversations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  muted boolean not null default false,
  primary key(conv_id, user_id)
);
create index if not exists members_user_idx on members(user_id);

create table if not exists group_keys(
  conv_id uuid not null references conversations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  version int not null,
  wrapped_key text not null,         -- group key encrypted for this member (server cannot read it)
  iv text not null,
  wrapped_by uuid references users(id) on delete set null,
  primary key(conv_id, user_id, version)
);

create table if not exists messages(
  id bigserial primary key,
  conv_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid references users(id) on delete set null,
  ciphertext text not null,          -- only ciphertext is stored
  iv text not null,
  key_version int not null default 1,
  created_at timestamptz not null default now(),
  deleted boolean not null default false
);
create index if not exists messages_conv_idx on messages(conv_id, id desc);

create table if not exists blocks(
  blocker uuid not null references users(id) on delete cascade,
  blocked uuid not null references users(id) on delete cascade,
  primary key(blocker, blocked)
);

create table if not exists notifications(
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  data jsonb not null default '{}',
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications(user_id, id desc);

create table if not exists push_subs(
  endpoint text primary key,
  user_id uuid not null references users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create table if not exists plays(
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  game_path text not null,
  game_title text not null,
  started_at timestamptz not null default now(),
  last_ping timestamptz not null default now(),
  ended_at timestamptz,
  seconds int not null default 0
);
create index if not exists plays_user_idx on plays(user_id, id desc);
create index if not exists plays_started_idx on plays(started_at desc);
`;

const MIGRATE = `
alter table users add column if not exists is_admin boolean not null default false;
alter table users add column if not exists banned boolean not null default false;
alter table users add column if not exists status_text text;
alter table users add column if not exists status_icon text;
alter table users add column if not exists status_mode text not null default 'online';
alter table users add column if not exists status_expires timestamptz;
create index if not exists messages_created_idx on messages(created_at);
alter table users add column if not exists beta_until timestamptz;
alter table users add column if not exists referral_code text;
alter table users add column if not exists referred_by uuid references users(id) on delete set null;
alter table users add column if not exists ref_credited boolean not null default false;
alter table users add column if not exists theme jsonb;
create unique index if not exists users_refcode_idx on users(referral_code) where referral_code is not null;
alter table conversations add column if not exists is_public boolean not null default false;
alter table conversations add column if not exists description text;
alter table conversations add column if not exists topic text;
create index if not exists conversations_public_idx on conversations(is_public) where is_public;
create table if not exists conv_bans(conv_id uuid not null references conversations(id) on delete cascade, user_id uuid not null references users(id) on delete cascade, primary key(conv_id,user_id));
create table if not exists reactions(msg_id bigint not null references messages(id) on delete cascade, user_id uuid not null references users(id) on delete cascade, emoji text not null, created_at timestamptz not null default now(), primary key(msg_id,user_id,emoji));
create table if not exists pins(msg_id bigint primary key references messages(id) on delete cascade, conv_id uuid not null references conversations(id) on delete cascade, pinned_by uuid references users(id) on delete set null, created_at timestamptz not null default now());
create index if not exists pins_conv_idx on pins(conv_id);
create table if not exists reports(id bigserial primary key, reporter_id uuid references users(id) on delete set null, kind text not null, target_user uuid references users(id) on delete set null, conv_id uuid references conversations(id) on delete set null, msg_id bigint, reason text not null, note text, snapshot text, status text not null default 'open', handled_by uuid, created_at timestamptz not null default now());
create index if not exists reports_status_idx on reports(status, id desc);
alter table users add column if not exists verified boolean not null default false;
alter table users add column if not exists avatar text;
alter table users add column if not exists verified_at timestamptz;
alter table users add column if not exists msg_count int not null default 0;
alter table users add column if not exists react_count int not null default 0;
alter table users add column if not exists play_count int not null default 0;
alter table conversations add column if not exists system_kind text;
create unique index if not exists conversations_system_idx on conversations(system_kind) where system_kind is not null;
create table if not exists announcements(id bigserial primary key, title text not null, body text not null, button_label text, button_url text, created_by uuid references users(id) on delete set null, created_at timestamptz not null default now(), active boolean not null default true);
create table if not exists user_badges(user_id uuid not null references users(id) on delete cascade, badge text not null, earned_at timestamptz not null default now(), primary key(user_id,badge));
create table if not exists verifications(id bigserial primary key, user_id uuid not null references users(id) on delete cascade, image bytea, status text not null default 'pending', note text, reviewed_by uuid references users(id) on delete set null, created_at timestamptz not null default now(), reviewed_at timestamptz);
create index if not exists verifications_status_idx on verifications(status, id);
alter table messages add column if not exists edited_at timestamptz;
alter table conversations add column if not exists ttl_seconds int;
alter table users add column if not exists bio text;
alter table users add column if not exists banner text;
alter table users add column if not exists folders jsonb not null default '[]'::jsonb;
create table if not exists scheduled(id bigserial primary key, conv_id uuid not null references conversations(id) on delete cascade, sender_id uuid not null references users(id) on delete cascade, ciphertext text not null, iv text not null, key_version int not null, send_at timestamptz not null, created_at timestamptz not null default now());
create index if not exists scheduled_due_idx on scheduled(send_at);
create table if not exists polls(msg_id bigint primary key references messages(id) on delete cascade, conv_id uuid not null references conversations(id) on delete cascade, n int not null);
create table if not exists poll_votes(msg_id bigint not null references polls(msg_id) on delete cascade, user_id uuid not null references users(id) on delete cascade, opt int not null, primary key(msg_id,user_id));
create table if not exists games2(msg_id bigint primary key references messages(id) on delete cascade, conv_id uuid not null references conversations(id) on delete cascade, kind text not null, p1 uuid not null, p2 uuid not null, state jsonb not null, turn uuid, winner text, created_at timestamptz not null default now());
create table if not exists stickers(id bigserial primary key, user_id uuid not null references users(id) on delete cascade, name text not null, url text not null, crop jsonb, created_at timestamptz not null default now());
create index if not exists stickers_user_idx on stickers(user_id);
update users u set msg_count = least(500, (select count(*) from messages m where m.sender_id=u.id)) where msg_count=0;
`;

async function init() {
  await pool.query(SCHEMA);                                  // create everything if it does not exist yet
  await pool.query(MIGRATE);                                 // additive migrations, safe to rerun
}

module.exports = { pool, q, init };
