/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0d0b0a",
        gold: {
          DEFAULT: "#A16207",
          light: "#fbbf24",
          pale: "#fcd34d",
        },
      },
      fontFamily: {
        display: ['"Avenir Next Condensed"', '"Arial Narrow"', '"PingFang SC"', "sans-serif"],
      },
    },
  },
  plugins: [],
};
