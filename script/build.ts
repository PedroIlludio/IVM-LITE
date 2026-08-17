import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, readdir, writeFile } from "fs/promises";
import JavaScriptObfuscator from "javascript-obfuscator";
import { join } from "path";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  console.log("obfuscating client JS...");
  await obfuscateAssets("dist/public/assets");
}

async function obfuscateAssets(dir: string) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await obfuscateAssets(fullPath);
    } else if (entry.name.endsWith(".js") && !entry.name.endsWith(".min.js")) {
      console.log(`  obfuscating ${fullPath}...`);
      const code = await readFile(fullPath, "utf-8");
      const result = JavaScriptObfuscator.obfuscate(code, {
        compact: true,
        controlFlowFlattening: false,
        deadCodeInjection: false,
        identifierNamesGenerator: "hexadecimal",
        renameGlobals: false,
        selfDefending: false,
        stringArray: true,
        stringArrayCallsTransform: false,
        stringArrayEncoding: ["none"],
        stringArrayRotate: true,
        stringArrayShuffle: true,
        stringArrayThreshold: 0.3,
        transformObjectKeys: false,
        splitStrings: false,
        target: "browser",
        sourceMap: false,
      });
      await writeFile(fullPath, result.getObfuscatedCode());
    }
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
