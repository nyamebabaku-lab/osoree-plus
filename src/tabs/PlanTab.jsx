import { ArrowDown, ArrowUp, BookOpen, FileText, Image, Languages, Music, UserRound, X } from 'lucide-react';
import { useStore } from '../store.js';
import { verseText } from '../lib/bible.js';
import { slideKey, slideTitle } from '../lib/slides.js';
import { songSlides } from '../lib/songs.js';
import { Empty } from '../ui.jsx';

const ICON = { verse: BookOpen, song: Music, media: Image, pdf: FileText, strongs: Languages, name: UserRound };

function detail(item, { bible, songs, media, people = [] }) {
  if (item.type === 'verse') return item.refs.length > 1 ? `${item.refs.length} passages together` : verseText(bible, item.refs[0].b, item.refs[0].c, item.refs[0].v);
  if (item.type === 'song') { const s = songs.find((x) => x.id === item.songId); return s ? songSlides(s.lyrics)[0]?.lines[0] || '' : ''; }
  if (item.type === 'strongs') return item.entry.def;
  if (item.type === 'name') return people.find((p) => p.id === item.personId)?.title || 'Name';
  const m = media.find((x) => x.id === item.mediaId);
  if (!m) return '';
  return m.kind === 'pdf' ? `PDF · ${m.pages.length} pages` : m.kind === 'video' ? 'Video' : 'Picture';
}

function Row({ item, ctx, live, onShow, children }) {
  const Icon = ICON[item.type];
  return (
    <div className={`flex items-center gap-1 rounded-xl ${live ? 'bg-gold-400/20 ring-1 ring-gold-500' : 'card'}`}>
      <button onClick={onShow} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left">
        <Icon size={18} className="shrink-0 text-gold-500" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">{slideTitle(item, ctx)}</span>
          <span className="block truncate text-sm text-stone-500 dark:text-stone-400">{detail(item, ctx)}</span>
        </span>
      </button>
      {children}
    </div>
  );
}

export default function PlanTab({ bible }) {
  const { plan, history, live, mode, songs, media, people, goLive, removePlan, movePlan, clearPlan, clearHistory, setCombine } = useStore();
  const ctx = { bible, songs, media, people };
  const liveKey = mode === 'show' && live ? slideKey(live.type === 'song' ? { ...live, idx: 0 } : live.type === 'pdf' ? { ...live, page: 0 } : live) : '';
  const show = (item) => { setCombine(false); const { id, ...slide } = item; goLive(slide); }; // eslint-disable-line no-unused-vars
  return (
    <div className="space-y-5">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <div className="label">Service plan</div>
          {plan.length > 0 && <button onClick={() => window.confirm('Clear the whole plan?') && clearPlan()} className="text-xs font-semibold text-red-600 dark:text-red-400">Clear plan</button>}
        </div>
        {!plan.length && <Empty>Line up verses, songs, pictures and videos for the service with the + and list buttons.</Empty>}
        <div className="space-y-1">
          {plan.map((x, i) => (
            <Row key={x.id} item={x} ctx={ctx} live={liveKey === slideKey(x)} onShow={() => show(x)}>
              <button onClick={() => movePlan(x.id, -1)} disabled={i === 0} aria-label="Move up" className="icon-btn disabled:opacity-30"><ArrowUp size={16} /></button>
              <button onClick={() => movePlan(x.id, 1)} disabled={i === plan.length - 1} aria-label="Move down" className="icon-btn disabled:opacity-30"><ArrowDown size={16} /></button>
              <button onClick={() => removePlan(x.id)} aria-label="Remove" className="icon-btn mr-1"><X size={16} /></button>
            </Row>
          ))}
        </div>
      </section>
      {history.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <div className="label">Verses shown recently</div>
            <button onClick={clearHistory} className="text-xs font-semibold text-stone-500">Clear</button>
          </div>
          <div className="space-y-1">
            {history.map((h) => <Row key={slideKey(h)} item={h} ctx={ctx} live={liveKey === slideKey(h)} onShow={() => show(h)} />)}
          </div>
        </section>
      )}
    </div>
  );
}
