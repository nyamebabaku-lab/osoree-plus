-- KJV+ (Strong's) is a Pro feature (works during the trial), unless the Super Admin unticks it in Settings.
update settings set data = jsonb_set(data, '{pro}', (data->'pro') || '["strongs"]'::jsonb)
where id = 1 and jsonb_typeof(data->'pro') = 'array' and not (data->'pro') ? 'strongs';
