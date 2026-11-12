-- Each SMS the server tries to send and what the SMS service answered (shown to the Super Admin).
create table if not exists sms_log (
  id bigserial primary key,
  phone text not null,
  ok boolean not null,
  reply text,
  created_at timestamptz not null default now()
);
alter table sms_log enable row level security;
