// Copies the MapLibre web worker into public/vendor so it is served from our
// own origin (CSP worker-src 'self'). Turbopack does not bundle MapLibre 6's
// separately loaded module worker. Runs on postinstall; output is gitignored.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkgPath = require.resolve("maplibre-gl/package.json");
const { version } = JSON.parse(readFileSync(pkgPath, "utf8"));

mkdirSync("public/vendor", { recursive: true });
copyFileSync(join(dirname(pkgPath), "dist", "maplibre-gl-worker.mjs"), `public/vendor/maplibre-gl-worker-${version}.mjs`);
console.log(`vendor: maplibre-gl-worker-${version}.mjs`);
