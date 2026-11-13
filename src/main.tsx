import React from 'react';
import { createRoot } from 'react-dom/client';
import './lib/install';
import App from './App';
import { ErrorBoundary } from './components/ui';
import './style.css';
import './theme.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); });
}
