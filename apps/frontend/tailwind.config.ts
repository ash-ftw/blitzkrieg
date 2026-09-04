import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        obsidian: "#090808",
        charcoal: "#161515",
        iron: "#2C2826",
        ash: "#6B6867",
        steel: "#95918F",
        gold: "#D5A028",
        molten: "#F5A329",
        crown: "#F5E5A5"
      }
    }
  },
  plugins: []
} satisfies Config;
