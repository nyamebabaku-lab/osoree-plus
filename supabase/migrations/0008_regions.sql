-- Prices by region: Ghana (GH₵, MoMo and card) and everywhere else (US$, card only).
alter table payments add column if not exists list_amount numeric;     -- the advertised price (e.g. 49 USD) when charged in another currency
alter table payments add column if not exists list_currency text;
alter table payments add column if not exists region text;             -- GH | INTL
alter table payments add column if not exists item_id text;            -- a store item bought by card
alter table devices add column if not exists ip_country text;          -- from the internet address (ipinfo.io)
alter table devices add column if not exists sim_country text;         -- from the phone's SIM card
alter table store_items add column if not exists price_usd numeric not null default 0;
