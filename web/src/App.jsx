import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Menu, X } from 'lucide-react';

const scenes = [
  { id: '01', label: 'Exploration', title: 'Beyond the mapped edge.', copy: 'Scout the unknown. Find the routes that change everything.', image: '/assets/landing/fleet-orbit.webp' },
  { id: '02', label: 'Conflict', title: 'Every vector is a decision.', copy: 'Read the field. Commit your fleet. Outmaneuver the opposition.', image: '/assets/landing/nebula-expedition.webp' },
  { id: '03', label: 'Diplomacy', title: 'Power travels through people.', copy: 'Trade, negotiate, and shape a frontier no commander controls alone.', image: '/assets/landing/wormhole-approach.webp' },
];

export default function App() {
  const [active, setActive] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const intervalRef = useRef(null);

  useEffect(() => {
    document.title = 'Starfront Dominion';
  }, []);

  useEffect(() => {
    const advance = () => setActive((value) => (value + 1) % scenes.length);
    const start = () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden) return;
      clearInterval(intervalRef.current);
      intervalRef.current = window.setInterval(advance, 8000);
    };
    const stop = () => clearInterval(intervalRef.current);
    const onVisibility = () => document.hidden ? stop() : start();
    document.addEventListener('visibilitychange', onVisibility);
    start();
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);

  const chooseScene = (index) => {
    setActive(index);
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && !document.hidden) {
      clearInterval(intervalRef.current);
      intervalRef.current = window.setInterval(() => setActive((value) => (value + 1) % scenes.length), 8000);
    }
  };

  return (
    <div className="landing-page">
      <div className="landing-scenes" aria-hidden="true">
        {scenes.map((scene, index) => <div key={scene.id} className={`landing-scene ${index === active ? 'is-active' : ''}`} style={{ backgroundImage: `url(${scene.image})` }} />)}
      </div>
      <div className="landing-vignette" aria-hidden="true" />
      <header className="landing-header">
        <a className="landing-brand" href="/" aria-label="Starfront Dominion home"><img src="/assets/branding/starfront-mark.svg" alt="" /><span><strong>STARFRONT</strong><small>/ DOMINION</small></span></a>
        <button className="landing-menu-button" type="button" aria-expanded={menuOpen} aria-controls="landing-nav" onClick={() => setMenuOpen((value) => !value)}><span className="sr-only">Menu</span>{menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}</button>
        <nav id="landing-nav" className={`landing-nav ${menuOpen ? 'is-open' : ''}`} aria-label="Main navigation">
          <a href="/game">The Game</a><a href="/ships">Ships</a><a href="/blog">Updates</a><a className="nav-play" href="/login.html">Play Now <ArrowRight aria-hidden="true" /></a>
        </nav>
      </header>
      <main>
        <section className="landing-hero" aria-labelledby="hero-title">
          <div className="hero-copy"><p className="hero-overline">A turn-based frontier strategy game</p><h1 id="hero-title">Your fleet.<br /><em>Your frontier.</em></h1><p className="hero-subtitle">Explore, build, and outmaneuver rival commanders.</p><div className="hero-actions"><a className="landing-button landing-button-primary" href="/login.html">Play Now <ArrowRight aria-hidden="true" /></a><a className="landing-button landing-button-quiet" href="/game">Explore the game <ArrowRight aria-hidden="true" /></a></div></div>
          <div className="scene-caption" aria-live="polite"><span className="scene-caption-index">{scenes[active].id} / {String(scenes.length).padStart(2, '0')}</span><strong>{scenes[active].label}</strong><p>{scenes[active].title}</p><span>{scenes[active].copy}</span></div>
          <div className="landing-controls" aria-label="Choose a scene"><div className="scene-progress" aria-hidden="true"><span key={active} /></div><div className="scene-dots">{scenes.map((scene, index) => <button key={scene.id} className={index === active ? 'is-active' : ''} type="button" aria-label={`Show ${scene.label} scene`} aria-current={index === active ? 'true' : undefined} onClick={() => chooseScene(index)}><span>{scene.id}</span></button>)}</div></div>
          <p className="landing-phrase">A galaxy shaped by your decisions</p>
        </section>
      </main>
      <footer className="landing-footer"><span>STARFRONT / DOMINION</span><a href="/blog">Updates</a><a href="/login.html">Play Now</a></footer>
    </div>
  );
}
