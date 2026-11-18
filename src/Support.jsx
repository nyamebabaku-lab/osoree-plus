// "Contact for help": the Super Admin's e-mail and WhatsApp (set in the admin app → Settings).
import { Mail, MessageCircle, Phone } from 'lucide-react';
import { useStore } from './store.js';
import { IS_NATIVE, Screen } from './lib/output.js';

/** WhatsApp wants the number with its country code and no "+" or spaces: 0505400054 → 233505400054. */
export const waNumber = (n) => { const d = String(n || '').replace(/\D/g, ''); return d.length === 10 && d.startsWith('0') ? '233' + d.slice(1) : d; };

export function openLink(url) {
  if (IS_NATIVE && url.startsWith('https://')) { Screen.openUrl({ url }).catch(() => {}); return; }
  if (url.startsWith('https://')) window.open(url, '_blank', 'noopener'); else window.location.href = url;
}

export function SupportLinks({ topic = 'I need help with Ɔsɔreɛ Plus', compact = false }) {
  const policy = useStore((s) => s.policy);
  const blocked = useStore((s) => s.blocked);
  const code = useStore((s) => s.deviceCode);
  const sup = { ...(policy?.support || {}), ...(blocked || {}) };
  const help = sup.help || policy?.dealer || '';
  const text = `${topic}. My device code: ${code || '(open Screen → Pro to see it)'}`;
  if (!sup.whatsapp && !sup.email && !help) return null;
  return (
    <div className={compact ? 'flex flex-wrap gap-2' : 'space-y-2'} aria-label="Contact for help">
      {!compact && <div className="label">Contact for help</div>}
      <div className="flex flex-wrap gap-2">
        {sup.whatsapp && <button onClick={() => openLink(`https://wa.me/${waNumber(sup.whatsapp)}?text=${encodeURIComponent(text)}`)} className="btn min-h-10 flex-1 bg-[#25D366] px-3 text-sm text-white"><MessageCircle size={16} /> WhatsApp</button>}
        {sup.email && <button onClick={() => openLink(`mailto:${sup.email}?subject=${encodeURIComponent(topic)}&body=${encodeURIComponent(text)}`)} className="btn-soft min-h-10 flex-1 px-3 text-sm"><Mail size={16} /> E-mail</button>}
        {!sup.whatsapp && help && /\d{9,}/.test(help.replace(/\s/g, '')) && <button onClick={() => openLink(`tel:${help.replace(/[^\d+]/g, '')}`)} className="btn-soft min-h-10 flex-1 px-3 text-sm"><Phone size={16} /> Call</button>}
      </div>
      {help && !compact && <p className="text-xs text-stone-500 dark:text-stone-400">{help}</p>}
    </div>
  );
}
