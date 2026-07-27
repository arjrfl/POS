/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#166534',
          light: '#16a34a',
          dark: '#14532d',
        },
        brand: {
          black: '#0A0A0A',
          charcoal: '#1C1C1C',
          gold: '#D4AF37',
          'gold-light': '#E5C766',
          'gold-dark': '#B8952C',
          white: '#FFFFFF',
          cream: '#FAF9F4',
        },
      },
    },
  },
  plugins: [],
}

