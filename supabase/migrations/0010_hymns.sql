-- Hymn books: a Pro feature (works during the trial), and a new kind of store item ('hymnal').
update settings set data = jsonb_set(data, '{pro}', (data->'pro') || '["hymns"]'::jsonb)
where id = 1 and jsonb_typeof(data->'pro') = 'array' and not (data->'pro') ? 'hymns';
comment on column store_items.kind is 'bible | background | hymnal';
