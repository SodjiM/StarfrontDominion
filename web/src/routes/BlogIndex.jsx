import { ArrowRight } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import SubpageHeader from '../components/SubpageHeader';
import { getPostsSortedNewestFirst } from '../data/posts';

function formatDate(value) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    .format(new Date(`${value}T00:00:00`));
}

export default function BlogIndex() {
  const posts = getPostsSortedNewestFirst();

  useEffect(() => {
    document.title = 'Updates · Starfront Dominion';
  }, []);

  return (
    <main className="updates-page">
      <div className="updates-backdrop" aria-hidden="true" />
      <SubpageHeader />
      <section className="updates-hero" aria-labelledby="updates-title">
        <p className="hero-overline">Updates</p>
        <h1 id="updates-title">Frontier dispatches.</h1>
        <p>Patch notes, development reports, and field changes from across Starfront Dominion.</p>
      </section>
      <section className="updates-feed" aria-label="Patch notes">
        {posts.map((post) => (
          <article className="update-card" key={post.id}>
            <time dateTime={post.date}>{formatDate(post.date)}</time>
            <h2><Link to={`/blog/${post.slug}`}>{post.title}</Link></h2>
            <p>{post.excerpt}</p>
            <Link className="update-read" to={`/blog/${post.slug}`}>Read dispatch <ArrowRight aria-hidden="true" /></Link>
          </article>
        ))}
      </section>
      <footer className="landing-footer updates-footer"><span>STARFRONT / DOMINION</span><Link to="/game">The Game</Link><Link to="/ships">Ships</Link><a href="/login.html">Play Now</a></footer>
    </main>
  );
}
