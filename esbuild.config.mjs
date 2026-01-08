import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "main.js",
  platform: "browser",
  format: "cjs",
  target: "es2020",
  sourcemap: watch,
  external: ["obsidian"],
  watch: watch && {
    onRebuild(error) {
      if (error) console.error("❌ Build failed", error);
      else console.log("✅ Rebuilt");
    }
  }
}).then(() => {
  console.log("✅ Build complete");
});
