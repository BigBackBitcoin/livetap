import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@livetap/ui/styles.css';
import './app.css';
import { App } from './App.js';

const host = document.getElementById('root');
if (!host) throw new Error('LIVETAP could not find its mount point.');

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
