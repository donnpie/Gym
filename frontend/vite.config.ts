import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the API runs separately (port 8100 unless run.ps1 -Port says otherwise).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": `http://127.0.0.1:${process.env.GYM_API_PORT || 8100}` },
  },
});
