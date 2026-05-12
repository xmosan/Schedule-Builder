import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          ink: "#12202f",
          mist: "#f5f2ea",
          stone: "#ebe3d5",
          teal: "#0f766e",
          ocean: "#155e75",
          coral: "#c75b39",
          moss: "#2f6f59",
        },
      },
      boxShadow: {
        glow: "0 24px 80px rgba(18, 32, 47, 0.12)",
      },
      backgroundImage: {
        "dashboard-radial":
          "radial-gradient(circle at top left, rgba(15, 118, 110, 0.18), transparent 26%), radial-gradient(circle at bottom right, rgba(199, 91, 57, 0.14), transparent 24%)",
      },
      fontFamily: {
        display: ["Sora", "Avenir Next", "Segoe UI", "sans-serif"],
        body: ["Avenir Next", "Segoe UI", "Helvetica Neue", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
