// Pages other than sign-in need a session cookie; without one, the browser is sent to /login.
import { NextResponse, type NextRequest } from "next/server";

const COOKIE = process.env.SESSION_COOKIE ?? "tt_session";

export function middleware(req: NextRequest) {
  const signedIn = req.cookies.has(COOKIE);
  if (!signedIn && !req.nextUrl.pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/", "/projects/:path*", "/tasks/:path*"] };
