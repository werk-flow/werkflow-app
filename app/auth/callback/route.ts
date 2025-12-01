import { NextRequest, NextResponse } from 'next/server';

import { createServerClient } from '@supabase/ssr';
import { type EmailOtpType } from '@supabase/supabase-js';
import { CURRENT_ORG_COOKIE, CURRENT_ORG_MAX_AGE } from '@/lib/org/cookies';

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const next = searchParams.get('next') ?? '/dashboard';
  const type = searchParams.get('type') as EmailOtpType | null;
  const inviteCode = searchParams.get('invite_code');

  // Determine the redirect destination based on the auth type
  let redirectTo = next;
  if (type === 'recovery') {
    redirectTo = '/reset-password';
  }

  // Handle token_hash verification (for cross-browser password reset and email confirmation)
  // This approach works across browsers because verification happens server-side
  if (tokenHash && type) {
    const res = NextResponse.redirect(`${origin}${redirectTo}`);

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name) {
            return req.cookies.get(name)?.value;
          },
          set(name, value, options) {
            res.cookies.set({ name, value, ...(options ?? {}) });
          },
          remove(name, options) {
            if (options) {
              res.cookies.delete({ name, ...options });
            } else {
              res.cookies.delete(name);
            }
          }
        }
      }
    );

    // Verify the OTP token_hash server-side
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type
    });

    if (error) {
      console.error('Token hash verification error:', error);
      // Redirect to reset-password with error for recovery, otherwise forgot-password
      if (type === 'recovery') {
        return NextResponse.redirect(
          `${origin}/reset-password?error=invalid_token&error_description=${encodeURIComponent(
            error.message
          )}`
        );
      }
      return NextResponse.redirect(
        `${origin}/forgot-password?error=invalid_token`
      );
    }

    // Successfully verified - session is now established in cookies
    return res;
  }

  if (code) {
    const res = NextResponse.redirect(`${origin}${redirectTo}`);

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name) {
            return req.cookies.get(name)?.value;
          },
          set(name, value, options) {
            res.cookies.set({ name, value, ...(options ?? {}) });
          },
          remove(name, options) {
            if (options) {
              res.cookies.delete({ name, ...options });
            } else {
              res.cookies.delete(name);
            }
          }
        }
      }
    );

    // Exchange the code for a session
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error('Code exchange error:', error);
      return NextResponse.redirect(
        `${origin}/forgot-password?error=invalid_code`
      );
    }

    // If there's an invite code, try to redeem it
    if (inviteCode) {
      const { data: redeemResult, error: redeemError } = await supabase.rpc(
        'redeem_organization_invite',
        { p_invite_code: inviteCode }
      );

      if (redeemError) {
        console.error('Invite redemption error:', redeemError);

        // Handle specific error cases
        if (redeemError.message?.includes('email_mismatch')) {
          // Extract the invited email from the error message (format: "email_mismatch::email@example.com")
          const emailMatch = redeemError.message.match(/email_mismatch::(.+)/);
          const invitedEmail = emailMatch ? emailMatch[1] : '';
          return NextResponse.redirect(
            `${origin}/invite-error?error=email_mismatch&email=${encodeURIComponent(
              invitedEmail
            )}&invite_code=${inviteCode}`
          );
        }
        if (redeemError.message?.includes('admin_mismatch')) {
          return NextResponse.redirect(
            `${origin}/invite-error?error=admin_mismatch`
          );
        }
        if (redeemError.message?.includes('invalid_invite')) {
          return NextResponse.redirect(
            `${origin}/invite-error?error=invalid_invite`
          );
        }
        if (redeemError.message?.includes('invite_expired')) {
          return NextResponse.redirect(
            `${origin}/invite-error?error=invite_expired`
          );
        }
        if (redeemError.message?.includes('invite_cancelled')) {
          return NextResponse.redirect(
            `${origin}/invite-error?error=invite_cancelled`
          );
        }
        if (redeemError.message?.includes('invite_already_used')) {
          return NextResponse.redirect(
            `${origin}/invite-error?error=invite_already_used`
          );
        }

        // For other errors, continue to dashboard but log the error
        console.error('Unknown invite error, continuing to dashboard');
      } else if (redeemResult && redeemResult.length > 0) {
        // Successfully redeemed - set the org cookie and redirect to dashboard with success flag
        // Use the new column names from the updated RPC function
        const orgId = redeemResult[0].org_id;
        const alreadyMember = redeemResult[0].already_member;

        // Create the redirect response with the correct URL
        const redirectUrl = alreadyMember
          ? `${origin}/dashboard?already_member=${orgId}`
          : `${origin}/dashboard?joined=${orgId}`;
        const redirectRes = NextResponse.redirect(redirectUrl);

        // Copy auth cookies from the original response to the redirect response
        res.cookies.getAll().forEach((cookie) => {
          redirectRes.cookies.set(cookie.name, cookie.value);
        });

        // Set the org cookie on the redirect response
        redirectRes.cookies.set({
          name: CURRENT_ORG_COOKIE,
          value: orgId,
          httpOnly: true,
          sameSite: 'lax',
          maxAge: CURRENT_ORG_MAX_AGE,
          path: '/'
        });

        return redirectRes;
      }
    }

    return res;
  }

  // Handle invite code without auth code (existing user clicking invite link)
  if (inviteCode) {
    // Check if user is already logged in
    const res = NextResponse.redirect(`${origin}/dashboard`);

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name) {
            return req.cookies.get(name)?.value;
          },
          set(name, value, options) {
            res.cookies.set({ name, value, ...(options ?? {}) });
          },
          remove(name, options) {
            if (options) {
              res.cookies.delete({ name, ...options });
            } else {
              res.cookies.delete(name);
            }
          }
        }
      }
    );

    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (user) {
      // User is logged in - redeem the invite
      const { data: redeemResult, error: redeemError } = await supabase.rpc(
        'redeem_organization_invite',
        { p_invite_code: inviteCode }
      );

      if (redeemError) {
        console.error(
          'Invite redemption error for existing user:',
          redeemError
        );

        if (redeemError.message?.includes('email_mismatch')) {
          // Extract the invited email from the error message (format: "email_mismatch::email@example.com")
          const emailMatch = redeemError.message.match(/email_mismatch::(.+)/);
          const invitedEmail = emailMatch ? emailMatch[1] : '';
          return NextResponse.redirect(
            `${origin}/invite-error?error=email_mismatch&email=${encodeURIComponent(
              invitedEmail
            )}&invite_code=${inviteCode}`
          );
        }
        if (redeemError.message?.includes('admin_mismatch')) {
          return NextResponse.redirect(
            `${origin}/invite-error?error=admin_mismatch`
          );
        }
        if (redeemError.message?.includes('invalid_invite')) {
          return NextResponse.redirect(
            `${origin}/invite-error?error=invalid_invite`
          );
        }
        if (redeemError.message?.includes('invite_expired')) {
          return NextResponse.redirect(
            `${origin}/invite-error?error=invite_expired`
          );
        }
        if (redeemError.message?.includes('invite_cancelled')) {
          return NextResponse.redirect(
            `${origin}/invite-error?error=invite_cancelled`
          );
        }
        if (redeemError.message?.includes('invite_already_used')) {
          return NextResponse.redirect(
            `${origin}/invite-error?error=invite_already_used`
          );
        }

        return NextResponse.redirect(`${origin}/dashboard`);
      }

      if (redeemResult && redeemResult.length > 0) {
        // Use the new column names from the updated RPC function
        const orgId = redeemResult[0].org_id;
        const alreadyMember = redeemResult[0].already_member;

        // Create the redirect response with the correct URL
        const redirectUrl = alreadyMember
          ? `${origin}/dashboard?already_member=${orgId}`
          : `${origin}/dashboard?joined=${orgId}`;
        const redirectRes = NextResponse.redirect(redirectUrl);

        // Set the org cookie on the redirect response
        redirectRes.cookies.set({
          name: CURRENT_ORG_COOKIE,
          value: orgId,
          httpOnly: true,
          sameSite: 'lax',
          maxAge: CURRENT_ORG_MAX_AGE,
          path: '/'
        });

        return redirectRes;
      }

      return res;
    } else {
      // User is not logged in - redirect to login with invite code preserved
      return NextResponse.redirect(`${origin}/login?invite_code=${inviteCode}`);
    }
  }

  // If no code, redirect to home
  return NextResponse.redirect(`${origin}/`);
}

export async function POST(req: NextRequest) {
  const { event, session } = await req.json();

  const res = NextResponse.json({ success: true });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name) {
          return req.cookies.get(name)?.value;
        },
        set(name, value, options) {
          res.cookies.set({ name, value, ...(options ?? {}) });
        },
        remove(name, options) {
          if (options) {
            res.cookies.delete({ name, ...options });
          } else {
            res.cookies.delete(name);
          }
        }
      }
    }
  );

  if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
    await supabase.auth.setSession(session);
  }

  if (event === 'SIGNED_OUT') {
    await supabase.auth.signOut();
  }

  return res;
}
