-- Why a device is blocked: 'admin' (by hand) or 'trial' (trial over, no Pro: unblocks itself when Pro arrives).
alter table devices add column if not exists block_kind text;
