/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@money-copilot/financial-engine",
    "@money-copilot/shared",
    "@money-copilot/persistence",
    "@money-copilot/open-finance",
    "@money-copilot/ai",
    "@money-copilot/app-services",
  ],
  // PGlite ships compiled WASM, and pluggy-sdk pulls in Node-only HTTP/JWT
  // internals — both are kept external (loaded as real node_modules at
  // runtime) rather than bundled. See DEC-024 (supersedes DEC-019).
  serverExternalPackages: ["@electric-sql/pglite", "pluggy-sdk"],
};

export default nextConfig;
