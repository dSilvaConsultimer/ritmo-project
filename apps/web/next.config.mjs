/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@money-copilot/financial-engine", "@money-copilot/shared"],
};

export default nextConfig;
