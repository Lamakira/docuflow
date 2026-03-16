console.log('[renderer] index.tsx loaded');
import { createRoot } from 'react-dom/client';
import './styles/globals.css';
import { App } from './app/App';

const rootEl = document.getElementById('root');
console.log('[renderer] root element:', rootEl ? 'found' : 'NOT FOUND');

if (rootEl) {
  console.log('[renderer] calling createRoot');
  createRoot(rootEl).render(<App />);
  console.log('[renderer] render() called');
} else {
  document.body.innerHTML = '<div style="color:red;padding:2rem;font-family:monospace">ERROR: #root element not found</div>';
}
