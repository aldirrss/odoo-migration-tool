/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next 15+: moved out of experimental
  serverExternalPackages: ["pg"],
};

module.exports = nextConfig;
