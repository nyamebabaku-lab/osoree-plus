import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import './index.css';
import App from './App.jsx';

// The projector fonts (public/fonts), so the font picker shows each one.
const fonts = document.createElement('link');
fonts.rel = 'stylesheet';
fonts.href = './fonts/fonts.css';
document.head.appendChild(fonts);

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
