import { defineConfig } from "vite";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";

export default defineConfig({
	plugins: [react()],
	base: process.env.GITHUB_ACTIONS ? "/th-address-latent/" : "/",
	build: {
		outDir: "demo-dist",
		rollupOptions: {
			input: {
				main: resolve(__dirname, "index.html"),
				explainer: resolve(__dirname, "explainer.html"),
			},
		},
	},
});
