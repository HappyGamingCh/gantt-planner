import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
// Shared controls before any component CSS, so a component rule (`.fix-button`, `.popover`, `.empty-card`) can
// modify them at equal specificity.
import './ui/common/controls.css';
import { App } from './App';
import { ErrorBoundary } from './ui/common/ErrorBoundary';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}
