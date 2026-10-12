import { NextResponse } from 'next/server';

/**
 * Which commit is actually serving.
 *
 * Twice now a fix has looked like it did not work when the browser was simply
 * still on the old build, and there was no way to tell the two apart from the
 * outside — every other route redirects to the login page, so a plain curl
 * learns nothing. This sits on the webhook path, which the gate lets through,
 * and reports the commit and the build time. It reads environment Vercel sets
 * itself and exposes nothing that is not already public on GitHub.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    message: process.env.VERCEL_GIT_COMMIT_MESSAGE?.split('\n')[0] ?? null,
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    env: process.env.VERCEL_ENV ?? 'development',
    now: new Date().toISOString(),
  });
}
