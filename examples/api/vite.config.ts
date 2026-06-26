import { dirname, resolve as resolvePath } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

// AWS SDK v3 ships two runtime entrypoints: `dist-es/runtimeConfig.js`
// (Node, uses node:http + process.version) and `dist-es/runtimeConfig.browser.js`
// (uses fetch + SubtleCrypto). The SDK's `package.json` swaps them via the
// legacy `browser` field map, but Vite + the Cloudflare plugin's
// `platform: "neutral"` resolver doesn't honor that swap. The Node version
// then fails inside workerd with
//   "(0 , __vite_ssr_import_0__.n) is not a function"
// because `nodejs_compat` doesn't expose what the Node runtime expects.
// This plugin (also installed as a Rolldown plugin so it runs during
// optimizeDeps pre-bundling) redirects the relative import to the browser
// sibling, which is what we want in a Worker anyway.
const AWS_SDK_IMPORTER_PATTERN = /[\\/]@aws-sdk[\\/][^\\/]+[\\/]/;

const awsSdkRuntimeRedirect = {
  name: "aws-sdk-use-browser-runtime",
  resolveId(source: string, importer: string | undefined) {
    if (
      source === "./runtimeConfig" &&
      importer !== undefined &&
      AWS_SDK_IMPORTER_PATTERN.test(importer)
    ) {
      return {
        id: resolvePath(dirname(importer), "runtimeConfig.browser.js"),
        external: false,
      };
    }
    return;
  },
};

const awsSdkBrowserRuntime: Plugin = {
  name: "aws-sdk-use-browser-runtime",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (
      source === "./runtimeConfig" &&
      importer !== undefined &&
      AWS_SDK_IMPORTER_PATTERN.test(importer)
    ) {
      return await this.resolve("./runtimeConfig.browser", importer, {
        ...options,
        skipSelf: true,
      });
    }
    return;
  },
};

export default defineConfig({
  server: {
    port: 8787,
    strictPort: true,
  },
  plugins: [cloudflare({}), awsSdkBrowserRuntime],
  // The Cloudflare plugin creates a per-worker Vite environment named after
  // the worker (dashes → underscores). Pre-bundling for that environment
  // ignores the legacy `package.json.browser` field map and pulls the AWS
  // SDK's Node runtimeConfig.js, which fails inside workerd. Inject our
  // runtime redirect Rolldown plugin into that environment's optimizeDeps
  // so the pre-bundle picks runtimeConfig.browser.js instead.
  environments: {
    olos_example_api: {
      optimizeDeps: {
        include: ["@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner"],
        rolldownOptions: {
          plugins: [awsSdkRuntimeRedirect],
        },
      },
    },
  },
});
