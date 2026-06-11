import { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import ParticleField from './components/ParticleField';
import { indexData } from './lib/content';
import { moduleCompletion, useProgress } from './lib/progress';

export default function App() {
  const { state } = useProgress();
  const location = useLocation();

  useEffect(() => {
    if (!location.hash) window.scrollTo(0, 0);
  }, [location.pathname, location.hash]);

  const totals = indexData.modules.reduce(
    (acc, m) => {
      const c = moduleCompletion(m, state);
      return { done: acc.done + c.done, total: acc.total + c.total };
    },
    { done: 0, total: 0 },
  );
  const pct = totals.total === 0 ? 0 : Math.round((totals.done / totals.total) * 100);

  return (
    <>
      <ParticleField />
      <div className="app-main">
        <header className="app-header">
          <Link to="/" className="brand">
            TLAD<span className="brand-dot">●</span>
            <span className="brand-sub">TECH LEAD · AI &amp; DATA</span>
          </Link>
          <div className="header-progress" title={`${totals.done} of ${totals.total} units complete`}>
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
              <circle cx="11" cy="11" r="9" fill="none" stroke="var(--border-strong)" strokeWidth="2.5" />
              <circle
                cx="11"
                cy="11"
                r="9"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={`${(pct / 100) * 2 * Math.PI * 9} ${2 * Math.PI * 9}`}
                transform="rotate(-90 11 11)"
              />
            </svg>
            <span>{pct}%</span>
          </div>
        </header>
        <Outlet />
      </div>
    </>
  );
}
