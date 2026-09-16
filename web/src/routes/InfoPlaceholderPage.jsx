import { ArrowRight } from 'lucide-react';
import { useEffect } from 'react';
import SubpageHeader from '../components/SubpageHeader';

export default function InfoPlaceholderPage({ section, title, description }) {
  useEffect(() => {
    document.title = `${section} · Starfront Dominion`;
  }, [section]);

  return (
    <main className="info-page">
      <div className="info-page-backdrop" aria-hidden="true" />
      <SubpageHeader />
      <section className="info-content" aria-labelledby="info-title">
        <p className="hero-overline">{section}</p>
        <h1 id="info-title">{title}</h1>
        <p>{description}</p>
        <a className="landing-button landing-button-primary" href="/login.html">Play Now <ArrowRight aria-hidden="true" /></a>
      </section>
    </main>
  );
}
