import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import './index.css';
// Two apps from one codebase: the operator app, and the Super Admin app (VITE_APP=admin).
const IS_ADMIN = import.meta.env.VITE_APP === 'admin';
if (IS_ADMIN) document.title = 'Ɔsɔreɛ Admin';

// The projector fonts (public/fonts), so the font picker shows each one.
if (!IS_ADMIN) {
  const fonts = document.createElement('link');
  fonts.rel = 'stylesheet';
  fonts.href = './fonts/fonts.css';
  document.head.appendChild(fonts);
}

const load = IS_ADMIN ? import('./admin/AdminApp.jsx') : import('./App.jsx');
load.then(({ default: Root }) => createRoot(document.getElementById('root')).render(<StrictMode><Root /></StrictMode>));
