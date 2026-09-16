import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function SubpageHeader({ backTo = '/', backLabel = 'Back to frontier' }) {
  return (
    <header className="info-header">
      <Link className="landing-brand" to="/" aria-label="Starfront Dominion home">
        <img src="/assets/branding/starfront-mark.svg" alt="" />
        <span><strong>STARFRONT</strong><small>/ DOMINION</small></span>
      </Link>
      <Link className="info-back" to={backTo}><ArrowLeft aria-hidden="true" /> {backLabel}</Link>
    </header>
  );
}
