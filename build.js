import esbuild from "esbuild";

esbuild.buildSync({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  format: "esm",
  bundle: true,
  legalComments: "external",
  //  minify: true
  define: {
    global: "self",
  }
});
