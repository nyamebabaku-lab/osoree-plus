-- Device register (model, system, area, features used), blocking, and releases the Super Admin publishes.
alter table devices add column if not exists model text;
alter table devices add column if not exists os text;
alter table devices add column if not exists country text;
alter table devices add column if not exists timezone text;
alter table devices add column if not exists features jsonb not null default '{}'::jsonb; -- { listen: 12, stream: 3, … } times used
alter table devices add column if not exists blocked boolean not null default false;
alter table devices add column if not exists block_reason text;
alter table devices add column if not exists blocked_at timestamptz;

create table if not exists releases (
  id bigint generated always as identity primary key,
  platform text not null,           -- android | windows | ios
  version text not null,            -- 1.9.0
  required boolean not null default false,
  notes text,
  url text,                         -- where to download (APK / setup); empty for iPhone (App Store)
  created_at timestamptz not null default now()
);
create index if not exists releases_platform on releases (platform, created_at desc);
alter table releases enable row level security;

-- Store items can also be sold through the App Store / Google Play: the matching product IDs.
alter table store_items add column if not exists apple_product text;
alter table store_items add column if not exists google_product text;
