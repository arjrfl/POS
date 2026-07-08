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
      },
    },
  },
  plugins: [],
}

