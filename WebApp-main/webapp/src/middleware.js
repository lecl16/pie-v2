import createIntlMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { NextResponse } from "next/server";

// Create the internationalization middleware
const intlMiddleware = createIntlMiddleware(routing);

// Function to add security headers to response
function addSecurityHeaders(response) {
  // Add security headers
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  
  // Only add HSTS in production
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  
  return response;
}

// Middleware function that handles i18n and security headers
export default async function middleware(request) {
  // First handle internationalization
  const response = await intlMiddleware(request);
  
  // Then add security headers
  return addSecurityHeaders(response);
}

// Match most paths except static assets
export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\.(?:jpg|png|gif|ico|svg|js|css)$).*)'],
};