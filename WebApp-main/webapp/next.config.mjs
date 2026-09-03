import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin('./src/i18n/request.js');

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "v0.blob.com",
        pathname: "/**",
      },
    ],
  },
  async redirects() {
    return [
      {
        source: '/',
        destination: '/en/login', 
        permanent: false,
      },
    ];
  },
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    return [
      {
        source: "/api/course/:courseId/:examId/:sessionId/get-submissions",
        destination: `${apiUrl}/course/:courseId/:examId/:sessionId/get-submissions`,
      },
    ];
  },
};

export default withNextIntl(nextConfig);