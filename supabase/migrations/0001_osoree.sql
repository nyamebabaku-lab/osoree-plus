-- Ɔsɔreɛ Plus licence server. Only the Edge Function (service role / direct connection) touches these tables:
-- row-level security is on with no policies, so the public API keys can read or change nothing.

create table if not exists settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into settings (id, data) values (1, jsonb_build_object(
  'trialDays', 30,
  'pro', jsonb_build_array('stream', 'live', 'wifi', 'docs', 'watermark', 'backup'),
  'currency', 'GHS',
  'prices', jsonb_build_object('pro', 350, 'year', 250),
  'provider', 'paystack',          -- paystack | hubtel
  'testMode', true,                -- payments are simulated until the Super Admin turns this off
  'movesPerYear', 2,               -- self-service moves of a licence to a new device
  'smsSender', 'Osoree',
  'dealer', ''                     -- shown in the app: who to call for help
)) on conflict (id) do nothing;

create table if not exists devices (
  code text primary key,                       -- OSR-XXXX-XXXX-XXXX
  first_seen timestamptz not null default now(),  -- the trial starts here, whatever the phone's clock says
  last_seen timestamptz not null default now(),
  platform text, version text
);

create table if not exists licences (
  id text primary key,                         -- also inside the signed licence ("n")
  device_code text not null,
  product text not null,                       -- pro | year
  expires_at timestamptz,                      -- null = no end
  church text, phone text,
  status text not null default 'active' check (status in ('active', 'revoked', 'moved')),
  source text not null,                        -- payment | code | admin | restore
  source_ref text,                             -- payment id, activation code, or the licence it was moved from
  token text not null,
  created_at timestamptz not null default now()
);
create index if not exists licences_device on licences (device_code) where status = 'active';
create index if not exists licences_phone on licences (phone);

create table if not exists payments (
  id text primary key,                         -- our reference, sent to the provider
  device_code text not null,
  product text not null,
  amount numeric(12, 2) not null,
  currency text not null default 'GHS',
  phone text, email text, church text,
  provider text not null,                      -- paystack | hubtel | test | play
  provider_ref text,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  licence_id text,
  error text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists payments_device on payments (device_code);

create table if not exists activation_codes (
  code text primary key,                       -- e.g. GRACE-7K2M-9QXP
  product text not null,                       -- pro | year
  uses_total int not null default 1 check (uses_total > 0),
  uses_left int not null default 1 check (uses_left >= 0),
  church text, note text,
  expires_at timestamptz,                      -- the code can no longer be used after this
  created_at timestamptz not null default now()
);

create table if not exists restore_codes (
  phone text primary key,
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null
);

create table if not exists admins (
  user_id uuid primary key,
  email text not null,
  created_at timestamptz not null default now()
);

alter table settings enable row level security;
alter table devices enable row level security;
alter table licences enable row level security;
alter table payments enable row level security;
alter table activation_codes enable row level security;
alter table restore_codes enable row level security;
alter table admins enable row level security;
