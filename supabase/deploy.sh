#!/usr/bin/env bash
# Installs the Ɔsɔreɛ Plus licence server on Supabase project inoxsalemgwgrzftamxs (safe to run again):
# database tables, the "osoree" Edge Function, and its secrets. Needs ~/.supabase/osoree-token.
set -e
cd "$(dirname "$0")/.."
REF=inoxsalemgwgrzftamxs
TOKEN=$(cat ~/.supabase/osoree-token)
API=https://api.supabase.com/v1/projects/$REF
H=(-H "Authorization: Bearer $TOKEN")

echo "1/3 Database tables"
for f in supabase/migrations/*.sql; do
  python3 -c 'import json,sys; print(json.dumps({"query": open(sys.argv[1]).read(), "read_only": False}))' "$f" \
    | curl -sf "${H[@]}" -H 'Content-Type: application/json' -X POST "$API/database/query" --data @- >/dev/null
done

echo "2/3 Secrets"
KEY=$(cat ../osoree-plus-signing/licence-private.key)
EMAIL=$(git config user.email 2>/dev/null || true)
EMAIL=${SUPER_ADMIN_EMAIL:-$EMAIL}
HOOK=$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')
EXISTING=$(curl -sf "${H[@]}" "$API/secrets" | python3 -c 'import json,sys; print(" ".join(s["name"] for s in json.load(sys.stdin)))')
python3 - "$KEY" "$EMAIL" "$HOOK" "$EXISTING" <<'PY' > /tmp/osoree-secrets.$$.json
import json, sys
key, email, hook, existing = sys.argv[1:5]
out = [{"name": "LICENCE_PRIVATE_KEY", "value": key}]
if email: out.append({"name": "SUPER_ADMIN_EMAIL", "value": email})
if "WEBHOOK_SECRET" not in existing.split(): out.append({"name": "WEBHOOK_SECRET", "value": hook})
print(json.dumps(out))
PY
curl -sf "${H[@]}" -H 'Content-Type: application/json' -X POST "$API/secrets" --data @/tmp/osoree-secrets.$$.json >/dev/null
rm -f /tmp/osoree-secrets.$$.json

echo "3/3 Edge Function"
curl -sf "${H[@]}" -X POST "$API/functions/deploy?slug=osoree" \
  -F 'metadata={"entrypoint_path":"index.ts","name":"osoree","verify_jwt":false};type=application/json' \
  -F "file=@supabase/functions/osoree/index.ts;filename=index.ts" \
  -F "file=@supabase/functions/osoree/core.js;filename=core.js" >/dev/null
echo "Done: https://$REF.supabase.co/functions/v1/osoree"
