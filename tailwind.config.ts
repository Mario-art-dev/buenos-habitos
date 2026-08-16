import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fdf2f8",
          100: "#fce7f3",
          400: "#f472b6",
          500: "#ec4899",
          600: "#db2777",
          700: "#be185d",
        },
        ink: {
          900: "#0b0b12",
          800: "#131320",
          700: "#1b1b2c",
          600: "#26263c",
        },
      },
    },
  },
  plugins: [],
};

export default config;
