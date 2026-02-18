import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Use relative paths so the build works on GitHub Pages under /<repo>/.
  base: "./",
  plugins: [react()],
});

