import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE_NAME = "omt_session";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const isApi = pathname.startsWith("/api/");

  if (!token) {
    if (isApi) {
      return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/projects/:path*",
    "/api/connections/:path*",
    "/api/projects/:path*",
    "/api/admin/:path*",
  ],
};
