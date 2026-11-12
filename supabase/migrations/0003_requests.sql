-- Pro licence requests: the church pays the Super Admin by Mobile Money and asks for Pro from the app;
-- the Super Admin approves (a licence is issued for that device) or declines in the admin app.
create table if not exists licence_requests (
  id text primary key,
  device_code text not null,
  product text not null,
  amount numeric not null,
  currency text not null default 'GHS',
  phone text not null,
  church text,
  momo_ref text not null,
  note text,
  status text not null default 'pending',     -- pending | approved | declined | replaced
  reason text,                                 -- why it was declined
  licence_id text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists licence_requests_status on licence_requests (status, created_at desc);
create index if not exists licence_requests_device on licence_requests (device_code, created_at desc);
alter table licence_requests enable row level security;
-- Settings saved by an earlier server version as a quoted JSON string: turn them back into an object.
update settings set data = (data #>> '{}')::jsonb where jsonb_typeof(data) = 'string';
