import esbuild from "esbuild";

esbuild.buildSync({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  format: "iife",
  bundle: true,
  legalComments: "external",
  //  minify: true
  define: {
    global: "self",
  },
  inject: ["timers.js", "polyfill.js"],
});
