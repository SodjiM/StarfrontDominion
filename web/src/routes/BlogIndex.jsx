import { Link } from 'react-router-dom';
import { getPostsSortedNewestFirst } from '../data/posts';

export default function BlogIndex() {
  return (
    <div className="min-h-screen bg-[#070912] text-slate-100 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(14,165,233,0.08),transparent_60%),radial-gradient(ellipse_at_bottom_left,rgba(99,102,241,0.08),transparent_55%)]" />
      <div className="relative z-10 mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-3xl font-extrabold">Patch Notes</h1>
          <Link to="/" className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100/90 hover:bg-white/10">
            ← Home
          </Link>
        </div>
        <div className="mt-6 space-y-4">
          {getPostsSortedNewestFirst().map(p => (
            <Link key={p.id} to={`/blog/${p.slug}`} className="block rounded-2xl border border-white/10 bg-white/5 p-5 hover:bg-white/10 transition">
              <div className="text-xs text-slate-400">{new Date(p.date).toLocaleDateString()}</div>
              <h2 className="mt-2 text-xl font-semibold">{p.title}</h2>
              <p className="mt-2 text-slate-300/90 text-sm">{p.excerpt}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

