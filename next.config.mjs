/** @type {import('next').NextConfig} */
const nextConfig = {
  // Recharts uses some browser globals; suppress the SSR warning
  // (the entire dashboard is 'use client', so this is never a real error)
  webpack: (config) => {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    return config;
  },
};

export default nextConfig;
