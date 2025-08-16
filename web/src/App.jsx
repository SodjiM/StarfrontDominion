import { useEffect } from 'react';
import {
  Rocket, Radar, Shield, Swords, ArrowRight, ExternalLink, Mail, Rss, Play
} from 'lucide-react';

const mockPosts = [
  {
    id: 1,
    title: 'Patch 0.3.7 — Asteroid Overhaul & Mining Cargo UI',
    date: '2025-08-14',
    excerpt:
      'Performance-optimized asteroid fields, persistent rock nodes, and per-ship cargo panes. Plus warp beacon visibility tuning.',
    href: '/blog/patch-0-3-7',
  },
  {
    id: 2,
    title: 'Design Notes — Senate Tags & Policy Cards',
    date: '2025-08-10',
    excerpt:
      'How ideology tags shape quests, influence thresholds, and unlockable policy actives. A look at Centralist vs. Decentralist arcs.',
    href: '/blog/senate-design-notes',
  },
  {
    id: 3,
    title: 'Ship Roster Refresh — Frigates & Battleships',
    date: '2025-08-03',
    excerpt:
      'Needle Gunship, Brute, and hybrid roles. Target falloff curves, ECM counters, and warp-interdiction balance.',
    href: '/blog/roster-refresh',
  },
];

export default function App() {
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--stars1', generateStars(80));
    root.style.setProperty('--stars2', generateStars(60));
    root.style.setProperty('--stars3', generateStars(40));
  }, []);

  return (
    <div className="min-h-screen bg-[#070912] text-slate-100 relative overflow-hidden">
      <Starfield />

      <header className="relative z-10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 flex items-center justify-between">
          <a href="#" className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500 shadow-lg shadow-cyan-500/20 grid place-items-center">
              <Rocket className="h-5 w-5" />
            </div>
            <span className="font-semibold tracking-wide text-slate-100">Starfront Dominion</span>
          </a>
          <nav className="hidden md:flex items-center gap-8 text-slate-300">
            <a className="hover:text-white/90" href="#features">Features</a>
            <a className="hover:text-white/90" href="#factions">Factions</a>
            <a className="hover:text-white/90" href="#blog">Patch Notes</a>
            <a className="hover:text-white/90" href="#cta">Join</a>
          </nav>
          <div className="flex items-center gap-3">
            <a href="/play" className="hidden sm:inline-flex items-center gap-2 rounded-xl bg-cyan-500/90 hover:bg-cyan-400 text-slate-900 px-4 py-2 font-semibold shadow-lg shadow-cyan-500/25 transition">
              <Play className="h-4 w-4" /> Play Now
            </a>
          </div>
        </div>
      </header>

      <section className="relative z-10 pt-8 pb-20 sm:pb-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300 backdrop-blur">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              Live Play‑by‑Post Strategy • Turn‑Based Conquest
            </div>
            <h1 className="mt-5 text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight">
              Forge an Empire among the <span className="bg-gradient-to-r from-cyan-300 via-sky-400 to-indigo-400 bg-clip-text text-transparent">stars</span>.
            </h1>
            <p className="mt-5 text-lg text-slate-300/90 max-w-xl">
              Start in your own sector, mine asteroid belts, weave warp networks, and outsmart rival houses with Senate politics, stealth beacons, and decisive fleet battles.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <a href="/play" className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 hover:bg-cyan-400 text-slate-900 px-6 py-3 font-semibold shadow-lg shadow-cyan-500/30 focus:outline-none focus:ring-2 focus:ring-cyan-400">
                <Play className="h-5 w-5" /> Play Now
              </a>
              <a href="#trailer" className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-6 py-3 font-semibold text-slate-100/90 hover:bg-white/10">
                Watch Trailer <ArrowRight className="h-4 w-4" />
              </a>
            </div>
            <div className="mt-8 grid grid-cols-3 gap-6 text-center">
              <Stat label="5,000×5,000 Grids" value="Sector Scale" />
              <Stat label="30+ Minerals" value="Living Economy" />
              <Stat label="Tactical ECM" value="Deep Combat" />
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-10 rounded-[2.5rem] bg-gradient-to-tr from-cyan-500/10 via-indigo-500/10 to-transparent blur-3xl" />
            <div className="relative rounded-3xl border border-white/10 bg-white/5 p-3 backdrop-blur-xl shadow-2xl">
              <div className="aspect-[16/10] w-full rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 grid place-items-center overflow-hidden">
                <div className="w-full h-full bg-[radial-gradient(ellipse_at_bottom,rgba(56,189,248,0.15),transparent_60%),radial-gradient(ellipse_at_top_right,rgba(99,102,241,0.18),transparent_50%)]" />
                <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between text-xs text-slate-300/80">
                  <div className="inline-flex items-center gap-2"><Radar className="h-4 w-4"/> Galaxy Map</div>
                  <div className="inline-flex items-center gap-2"><Shield className="h-4 w-4"/> Sector Control</div>
                  <div className="inline-flex items-center gap-2"><Swords className="h-4 w-4"/> Fleet Clash</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="relative z-10 py-16 sm:py-24 border-t border-white/10 bg-white/[0.02]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-3 gap-6">
            <FeatureCard icon={<Radar className="h-6 w-6"/>} title="Discover & Exploit">
              Scan asteroid belts, anchor mining outposts, and route convoys through hidden warp beacons.
            </FeatureCard>
            <FeatureCard icon={<Swords className="h-6 w-6"/>} title="Turn‑Based Tactics">
              Range falloff, interdiction bubbles, ECM duels, and alpha‑strike windows create real maneuver.
            </FeatureCard>
            <FeatureCard icon={<Shield className="h-6 w-6"/>} title="Senate & Policy Cards">
              Align with ideologies, complete quests, and unlock empire‑wide actives that reshape the map.
            </FeatureCard>
          </div>
        </div>
      </section>

      <section id="blog" className="relative z-10 py-16 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between mb-8">
            <h2 className="text-2xl sm:text-3xl font-bold">Latest Patch Notes</h2>
            <a href="/blog" className="text-sm text-cyan-300 hover:text-cyan-200 inline-flex items-center gap-1">
              View all <ExternalLink className="h-3.5 w-3.5"/>
            </a>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {mockPosts.map((post) => (
              <article key={post.id} className="group rounded-2xl border border-white/10 bg-white/5 p-5 hover:bg-white/10 transition">
                <div className="text-xs text-slate-400 flex items-center gap-2"><Rss className="h-3.5 w-3.5"/> {new Date(post.date).toLocaleDateString()}</div>
                <h3 className="mt-2 text-lg font-semibold leading-snug group-hover:text-white"><a href={post.href}>{post.title}</a></h3>
                <p className="mt-2 text-sm text-slate-300/90">{post.excerpt}</p>
                <a href={post.href} className="mt-4 inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200 text-sm">Read patch notes <ArrowRight className="h-3.5 w-3.5"/></a>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="cta" className="relative z-10 py-16 sm:py-24">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-cyan-500/10 via-indigo-500/10 to-white/5 p-8 sm:p-12 text-center">
            <h3 className="text-2xl sm:text-3xl font-bold">Ready to carve your legend?</h3>
            <p className="mt-3 text-slate-300/90">Jump in now. Your sector awaits — and so do your rivals.</p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
              <a href="/play" className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 hover:bg-cyan-400 text-slate-900 px-6 py-3 font-semibold shadow-lg shadow-cyan-500/30">
                <Play className="h-5 w-5"/> Play Now
              </a>
              <a href="/newsletter" className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-6 py-3 font-semibold text-slate-100/90 hover:bg-white/10">
                <Mail className="h-4 w-4"/> Get Updates
              </a>
            </div>
          </div>
        </div>
      </section>

      <footer className="relative z-10 border-t border-white/10 py-10 text-sm text-slate-400">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© {new Date().getFullYear()} Starfront Dominion. All rights reserved.</p>
          <nav className="flex items-center gap-6">
            <a className="hover:text-slate-200" href="/terms">Terms</a>
            <a className="hover:text-slate-200" href="/privacy">Privacy</a>
            <a className="hover:text-slate-200" href="/support">Support</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, children }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-cyan-400/20 to-indigo-400/20 grid place-items-center text-cyan-300 mb-4">
        {icon}
      </div>
      <h3 className="font-semibold text-lg">{title}</h3>
      <p className="mt-2 text-slate-300/90 text-sm">{children}</p>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-1 text-slate-100 font-semibold">{value}</div>
    </div>
  );
}

function Starfield() {
  return (
    <>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(14,165,233,0.08),transparent_60%),radial-gradient(ellipse_at_bottom_left,rgba(99,102,241,0.08),transparent_55%)]" />
      <style>{`
        :root {
          --stars1: "";
          --stars2: "";
          --stars3: "";
        }
        .stars:after, .stars:before { content: ""; position: absolute; inset: 0; background-repeat: repeat; }
        .stars.s1:after { background-image: var(--stars1); animation: twinkle 12s linear infinite; opacity: .4 }
        .stars.s2:after { background-image: var(--stars2); animation: twinkle 18s linear infinite; opacity: .6 }
        .stars.s3:after { background-image: var(--stars3); animation: twinkle 24s linear infinite; opacity: .9 }
        @keyframes twinkle { 0%{ transform: translateY(0)} 50%{ transform: translateY(-10px)} 100%{ transform: translateY(0)} }
      `}</style>
      <div className="stars s1 absolute inset-0" />
      <div className="stars s2 absolute inset-0" />
      <div className="stars s3 absolute inset-0" />
    </>
  );
}

function generateStars(count) {
  const size = 1200;
  const cvs = document.createElement('canvas');
  cvs.width = size; cvs.height = size;
  const ctx = cvs.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = 'rgba(255,255,255,0)'; ctx.fillRect(0,0,size,size);
  for (let i = 0; i < count; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = Math.random() * 1.2 + 0.3;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r*3);
    const hue = Math.random() < 0.85 ? 0 : 200 + Math.random()*40;
    const col = hue === 0 ? '255,255,255' : '150,200,255';
    g.addColorStop(0, `rgba(${col},0.95)`);
    g.addColorStop(1, `rgba(${col},0.0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r*3, 0, Math.PI*2);
    ctx.fill();
  }
  return `url(${cvs.toDataURL()})`;
}


