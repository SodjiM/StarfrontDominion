import { Link, useParams } from 'react-router-dom';
import { posts } from '../data/posts';

const postsBySlug = Object.fromEntries(posts.map(p => [p.slug, p]));

export default function BlogPost() {
  const { slug } = useParams();
  const post = postsBySlug[slug];

  if (!post) {
    return (
      <div className="min-h-screen bg-[#070912] text-slate-100 grid place-items-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Post not found</h1>
          <Link to="/blog" className="mt-4 inline-block text-cyan-300 hover:text-cyan-200">Back to Patch Notes</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070912] text-slate-100 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(14,165,233,0.08),transparent_60%),radial-gradient(ellipse_at_bottom_left,rgba(99,102,241,0.08),transparent_55%)]" />
      <div className="relative z-10 mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-12">
        <Link to="/blog" className="text-cyan-300 hover:text-cyan-200">← Back to Patch Notes</Link>
        <h1 className="mt-4 text-3xl font-extrabold">{post.title}</h1>
        <div className="mt-1 text-xs text-slate-400">{new Date(post.date).toLocaleDateString()}</div>
        <article className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-6 whitespace-pre-wrap leading-relaxed">
          {post.body}
        </article>
        <div className="mt-6">
          <div className="flex gap-3">
            <a href="/" className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-6 py-3 font-semibold text-slate-100/90 hover:bg-white/10">Home</a>
            <a href="/play" className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 hover:bg-cyan-400 text-slate-900 px-6 py-3 font-semibold shadow-lg shadow-cyan-500/30">Play the Alpha</a>
          </div>
        </div>
      </div>
    </div>
  );
}

