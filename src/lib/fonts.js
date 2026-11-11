// Typefaces for the screen. Fonts without the Twi letters ɔ ɛ Ɔ Ɛ fall back to Noto for those letters only.
// System ones need no file; the rest ship in public/fonts (scripts/copy-fonts.mjs).
export const FONTS = [
  ['serif', 'Classic serif', "Georgia, 'Times New Roman', serif"],
  ['sans', 'Clean sans', "system-ui, 'Segoe UI', Roboto, Arial, sans-serif"],
  ['montserrat', 'Montserrat', "'Montserrat', sans-serif"],
  ['poppins', 'Poppins', "'Poppins', 'Noto Sans', sans-serif"],
  ['open-sans', 'Open Sans', "'Open Sans', 'Noto Sans', sans-serif"],
  ['noto-sans', 'Noto Sans', "'Noto Sans', sans-serif"],
  ['oswald', 'Oswald', "'Oswald', 'Noto Sans', sans-serif"],
  ['bebas', 'Bebas Neue', "'Bebas Neue', 'Noto Sans', sans-serif"],
  ['merriweather', 'Merriweather', "'Merriweather', serif"],
  ['lora', 'Lora', "'Lora', 'Noto Serif', serif"],
  ['playfair', 'Playfair Display', "'Playfair Display', 'Noto Serif', serif"],
  ['roboto-slab', 'Roboto Slab', "'Roboto Slab', 'Noto Serif', serif"],
  ['noto-serif', 'Noto Serif', "'Noto Serif', serif"],
  ['dancing', 'Dancing Script', "'Dancing Script', 'Noto Serif', cursive"],
];
export const fontStack = (id) => (FONTS.find((f) => f[0] === id) || FONTS[0])[2];
