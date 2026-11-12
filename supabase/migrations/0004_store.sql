-- Store: Bibles and backgrounds the Super Admin uploads, free or paid (MoMo request → approval).
-- A purchase belongs to the church's phone number; every device that confirms that number (SMS code) gets it.
create table if not exists store_items (
  id text primary key,
  kind text not null,                 -- bible | background
  title text not null,
  abbr text,                          -- Bibles: short name shown in the app
  lang text,
  description text,
  copyright text,
  price numeric not null default 0,   -- 0 = free
  currency text not null default 'GHS',
  file_path text,                     -- in the private "store" bucket
  file_type text,                     -- bible-json-gz | image/jpeg | video/mp4 …
  file_size bigint,
  thumb text,                         -- small JPEG as a data: URL
  active boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
alter table store_items enable row level security;
alter table licence_requests add column if not exists item_id text;
create table if not exists device_phones (
  device_code text not null,
  phone text not null,
  created_at timestamptz not null default now(),
  primary key (device_code, phone)
);
alter table device_phones enable row level security;
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('store', 'store', false) on conflict (id) do nothing;
  end if;
end $$;
