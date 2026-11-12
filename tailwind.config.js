/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Marca Gestión Íntegra 4.0: el color primario (clases teal-*) pasa a ser el azul del logo
      colors: { teal: { 50: '#eef5ff', 100: '#d9e8ff', 200: '#bcd6ff', 300: '#8ebbff', 400: '#5996f5', 500: '#2f74e0', 600: '#1f5cc4', 700: '#1b4a9e', 800: '#1b3f80', 900: '#173a7a' } },
    },
  },
  plugins: [],
};
