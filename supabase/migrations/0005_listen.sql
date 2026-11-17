-- The scripture listener is a Pro feature unless the Super Admin unticks it in Settings.
update settings set data = jsonb_set(data, '{pro}', (data->'pro') || '["listen"]'::jsonb)
where id = 1 and jsonb_typeof(data->'pro') = 'array' and not (data->'pro') ? 'listen';
