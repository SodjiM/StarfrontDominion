import { ArrowRight } from 'lucide-react';
import { Fragment, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import SubpageHeader from '../components/SubpageHeader';
import { posts } from '../data/posts';

const postsBySlug = Object.fromEntries(posts.map((post) => [post.slug, post]));

function formatDate(value) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    .format(new Date(`${value}T00:00:00`));
}

function InlineText({ children }) {
  const parts = String(children).split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => part.startsWith('**') && part.endsWith('**')
    ? <strong key={index}>{part.slice(2, -2)}</strong>
    : <Fragment key={index}>{part}</Fragment>);
}

function PatchNoteBody({ body }) {
  const lines = body.split('\n');
  const blocks = [];
  let list = [];
  let skippedDocumentTitle = false;

  const flushList = () => {
    if (!list.length) return;
    blocks.push(<ul key={`list-${blocks.length}`}>{list.map((item, index) => <li key={index}><InlineText>{item}</InlineText></li>)}</ul>);
    list = [];
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line === '---') {
      flushList();
      return;
    }
    if (/^#\s/.test(line)) {
      flushList();
      if (!skippedDocumentTitle) {
        skippedDocumentTitle = true;
        return;
      }
      blocks.push(<h2 key={`heading-${blocks.length}`}><InlineText>{line.replace(/^#\s+/, '')}</InlineText></h2>);
      return;
    }
    if (/^##\s/.test(line)) {
      flushList();
      blocks.push(<h2 key={`heading-${blocks.length}`}><InlineText>{line.replace(/^##\s+/, '')}</InlineText></h2>);
      return;
    }
    if (/^\*\s/.test(line) || /^-\s/.test(line) || /^\d+\)\s/.test(line)) {
      list.push(line.replace(/^(?:\*|-|\d+\))\s+/, ''));
      return;
    }
    flushList();
    blocks.push(<p key={`paragraph-${blocks.length}`}><InlineText>{line}</InlineText></p>);
  });
  flushList();
  return blocks;
}

export default function BlogPost() {
  const { slug } = useParams();
  const post = postsBySlug[slug];

  useEffect(() => {
    document.title = post ? `${post.title} · Starfront Dominion` : 'Update not found · Starfront Dominion';
  }, [post]);

  if (!post) {
    return (
      <main className="info-page">
        <div className="updates-backdrop" aria-hidden="true" />
        <SubpageHeader backTo="/blog" backLabel="Back to updates" />
        <section className="info-content" aria-labelledby="missing-title">
          <p className="hero-overline">Signal lost</p>
          <h1 id="missing-title">Dispatch not found.</h1>
          <p>This update may have moved or never reached the archive.</p>
          <Link className="landing-button landing-button-primary" to="/blog">View all updates <ArrowRight aria-hidden="true" /></Link>
        </section>
      </main>
    );
  }

  return (
    <main className="update-article-page">
      <div className="updates-backdrop" aria-hidden="true" />
      <SubpageHeader backTo="/blog" backLabel="Back to updates" />
      <article className="update-article">
        <header>
          <p className="hero-overline">Field update</p>
          <h1>{post.title}</h1>
          <time dateTime={post.date}>{formatDate(post.date)}</time>
        </header>
        <div className="update-article-body"><PatchNoteBody body={post.body} /></div>
        <footer className="update-article-actions">
          <Link className="landing-button landing-button-quiet" to="/blog">All updates</Link>
          <a className="landing-button landing-button-primary" href="/login.html">Play Now <ArrowRight aria-hidden="true" /></a>
        </footer>
      </article>
    </main>
  );
}
