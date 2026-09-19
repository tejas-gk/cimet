import { clerkMiddleware } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"

export default clerkMiddleware(async (auth, request) => {
  const { userId } = await auth()

  if (!userId) {
    const signInUrl = new URL("/sign-in", request.url)
    signInUrl.searchParams.set("redirect_url", request.nextUrl.pathname)
    return NextResponse.redirect(signInUrl)
  }
})

export const config = {
  matcher: ["/((?!_next|favicon.ico|robots.txt|files).*)"],
}
