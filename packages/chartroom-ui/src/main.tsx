import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import './styles/base.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('chartroom-ui: #root element not found');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
