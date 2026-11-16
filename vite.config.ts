import { defineConfig } from "vite";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

// Keep Blender's stable source/export paths, while production URLs identify
// exact bytes and can be cached without revalidation across deployments.
export default defineConfig(({ mode }) => {
  const wallpaper = mode === "wallpaper";
  const models = (
    wallpaper ? ["archive-cassette", "archive-assembly"] : ["archive-cassette"]
  ).map((name) => {
    const source = readFileSync(`public/assets/${name}.glb`);
    const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
    return {
      key: `assets/${name}.glb`,
      fileName: `assets/${name}.${hash}.glb`,
      source,
    };
  });
  const hasNovecento =
    wallpaper &&
    ["Normal", "DemiBold", "Bold"].every((weight) =>
      existsSync(
        `public/fonts/novecento/webFonts/NovecentoSansWide${weight}/font.woff2`,
      ),
    );
  let outputDirectory = "";
  return {
    base: wallpaper ? "./" : "/",
    define: {
      __RHINE_MODELS__: JSON.stringify(
        Object.fromEntries(models.map((model) => [model.key, model.fileName])),
      ),
      __RHINE_NOVECENTO__: JSON.stringify(hasNovecento),
    },
    plugins: [
      {
        name: "versioned-model-assets",
        apply: "build",
        configResolved(config) {
          outputDirectory = resolve(config.root, config.build.outDir);
        },
        buildStart() {
          for (const model of models)
            this.emitFile({
              type: "asset",
              fileName: model.fileName,
              source: model.source,
            });
        },
        closeBundle() {
          if (wallpaper || !outputDirectory) return;
          // Vite copies public/ verbatim. Exclude removed presentation features
          // from the release without deleting their original source resources.
          for (const path of [
            "audio",
            "fonts/novecento",
            "assets/boot-lettering-notice.txt",
          ])
            rmSync(resolve(outputDirectory, path), {
              recursive: true,
              force: true,
            });
          const assets = resolve(outputDirectory, "assets");
          if (existsSync(assets))
            for (const name of readdirSync(assets)) {
              if (
                /^archive-assembly(?:\.[a-f0-9]+)?\.glb$/.test(name) ||
                name === "archive-cassette.glb"
              )
                rmSync(resolve(assets, name));
            }
        },
      },
      ...(wallpaper
        ? [
            {
              name: "wallpaper-host",
              transformIndexHtml(html: string) {
                return {
                  html: html.replace(/\s*<link rel="manifest"[^>]*>/, ""),
                  tags: [
                    {
                      tag: "script",
                      children: readFileSync("wallpaper/host.js", "utf8"),
                      injectTo: "head-prepend" as const,
                    },
                  ],
                };
              },
            },
          ]
        : []),
    ],
  };
});
