/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Next.js 14 only runs src/instrumentation.ts (the boot-time auto-migration
  // runner) when this flag is set - it's stable-by-default starting in
  // Next.js 15, but 14.x still gates it behind `experimental`. Without this,
  // every migration in instrumentation.ts silently never applies on an
  // existing deployment - almost certainly the real cause of the
  // "relation ... does not exist" KOT outage in commit 0fcd1b7.
  experimental: {
    instrumentationHook: true,
  },
}

module.exports = nextConfig
