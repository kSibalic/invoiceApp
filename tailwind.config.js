/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{html,js}"],
  theme: {
    extend: {
      fontFamily: { sans: ["Inter","ui-sans-serif","system-ui","-apple-system"] },
      colors: { brand: { DEFAULT: "#0b64d8", light: "#4ea5ff" } }
    },
  },
  plugins: [],
};
