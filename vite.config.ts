import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Entry pages: main window (index.html), desktop widget windows (desktop.html), the desktop menu (menu.html),
// the wallpaper (wallpaper.html), the cursor effects (fx.html) and the floating island (island.html).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Cargo writes into src-tauri\target while Vite runs; watching it causes EBUSY crashes on Windows.
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        desktop: fileURLToPath(new URL("./desktop.html", import.meta.url)),
        menu: fileURLToPath(new URL("./menu.html", import.meta.url)),
        wallpaper: fileURLToPath(new URL("./wallpaper.html", import.meta.url)),
        fx: fileURLToPath(new URL("./fx.html", import.meta.url)),
        island: fileURLToPath(new URL("./island.html", import.meta.url)),
      },
    },
  },
});
