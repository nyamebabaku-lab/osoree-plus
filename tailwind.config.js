/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: { sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'] },
      colors: {
        gold: { 50: '#fdf8e9', 100: '#faeec6', 200: '#f4db8c', 300: '#ecc552', 400: '#e2b232', 500: '#c99a1e', 600: '#a87b16', 700: '#865c15', 800: '#6e4a18', 900: '#5d3e19' },
        night: { 700: '#262a33', 800: '#1a1d24', 900: '#14161b', 950: '#0e0f13' },
        paper: { 50: '#fdfcf8', 100: '#f7f4ec', 200: '#ece7da', 300: '#ddd6c4' },
      },
    },
  },
  plugins: [],
};
