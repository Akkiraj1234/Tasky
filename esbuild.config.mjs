// esbuild.config.mjs
import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const buildOptions = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "main.js",
  platform: "browser",
  format: "cjs",
  target: "es2020",
  sourcemap: watch,
  external: ["obsidian"],
};

// If --watch was provided, add the watch object by calling build with it;
// otherwise call build without a watch option so esbuild doesn't complain.
if (watch) {
  esbuild.build({
    ...buildOptions,
    watch: {
      onRebuild(error) {
        if (error) console.error("❌ Rebuild failed:", error);
        else console.log("✅ Rebuilt");
      },
    },
  })
  .then(() => console.log("✅ Watch build started"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  esbuild.build(buildOptions)
    .then(() => {
      console.log("✅ Build complete");
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
