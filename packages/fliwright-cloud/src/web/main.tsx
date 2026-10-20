import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import './style.css';

// Apply the saved preference before rendering the console's first frame.
let theme = 'dark';
try {
  if (localStorage.getItem('cloud-theme') === 'light') theme = 'light';
} catch {}
document.documentElement.dataset.theme = theme;
document.documentElement.classList.toggle('dark', theme === 'dark');

createRoot(document.getElementById('root')!).render(<App />);
