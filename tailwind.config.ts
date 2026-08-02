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
          amber: "#b45309",
          sage: "#4a7c59",
          slate: "#64748b",
        },
      },
      boxShadow: {
        glow: "0 24px 80px rgba(18, 32, 47, 0.12)",
        card: "0 4px 16px rgba(18, 32, 47, 0.06), 0 1px 3px rgba(18, 32, 47, 0.04)",
        "card-hover": "0 8px 32px rgba(18, 32, 47, 0.1), 0 2px 6px rgba(18, 32, 47, 0.06)",
        "card-raised": "0 18px 48px rgba(18, 32, 47, 0.09), 0 4px 12px rgba(18, 32, 47, 0.05)",
        panel: "0 22px 58px rgba(18, 32, 47, 0.1), 0 4px 16px rgba(18, 32, 47, 0.06)",
        nav: "0 18px 48px rgba(18, 32, 47, 0.18), 0 2px 8px rgba(18, 32, 47, 0.08)",
        chat: "0 6px 24px rgba(18, 32, 47, 0.08), 0 1px 4px rgba(18, 32, 47, 0.04)",
        assistant: "0 32px 80px rgba(18, 32, 47, 0.1), 0 2px 8px rgba(18, 32, 47, 0.05)",
      },
      backgroundImage: {
        "dashboard-radial":
          "radial-gradient(circle at top left, rgba(15, 118, 110, 0.18), transparent 26%), radial-gradient(circle at bottom right, rgba(199, 91, 57, 0.14), transparent 24%)",
        "card-sheen":
          "linear-gradient(135deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.7) 100%)",
      },
      fontFamily: {
        display: ["Sora", "Avenir Next", "Segoe UI", "sans-serif"],
        body: ["Avenir Next", "Segoe UI", "Helvetica Neue", "sans-serif"],
      },
      borderRadius: {
        "4xl": "2rem",
        "5xl": "2.5rem",
      },
    },
  },
  plugins: [],
};

export default config;
