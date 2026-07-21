import packageJson from '../../package.json' with { type: 'json' };
import { createRoot } from 'react-dom/client';

import './style.css';

// eslint-disable-next-line no-restricted-syntax -- React mount boundary needs the static HTML root
const root = document.getElementById('root');

if (!root) {
  throw new Error('Could not find options root element');
}

createRoot(root).render(
  <main>
    <h1>YouTube Private Invitations</h1>
    <div className="version">Version {packageJson.version}</div>
    <nav>
      <a href="https://github.com/upleveled/youtube-private-invitations">Code</a>
      <span>•</span>
      <a href="https://github.com/upleveled/youtube-private-invitations/issues">
        Issues
      </a>
    </nav>
  </main>,
);
