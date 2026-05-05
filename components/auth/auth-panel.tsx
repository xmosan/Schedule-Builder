"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type AuthPanelProps = {
  error: string | null;
  isConfigured: boolean;
  isSubmitting: boolean;
  message: string | null;
  onSendMagicLink: (email: string) => Promise<void>;
  onSignInWithGoogle: () => Promise<void>;
  onSignInWithPassword: (email: string, password: string) => Promise<void>;
  onSignUp: (email: string, password: string) => Promise<void>;
};

export function AuthPanel({
  error,
  isConfigured,
  isSubmitting,
  message,
  onSendMagicLink,
  onSignInWithGoogle,
  onSignInWithPassword,
  onSignUp,
}: AuthPanelProps) {
  const [authMode, setAuthMode] = useState<"password" | "magic-link">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const canSubmitEmail = email.trim().length > 0;
  const canSubmitPassword = canSubmitEmail && password.trim().length > 0;

  return (
    <div className="px-3 py-6 sm:px-6 sm:py-10 lg:px-8 lg:py-14">
      <div className="app-shell">
        <div className="mx-auto max-w-xl">
          <Card className="rounded-[30px] border-white/75 bg-white/90">
            <CardContent className="p-5 sm:p-7">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>Account sync</Badge>
                <Badge variant="subtle">Cross-device sync</Badge>
              </div>

              <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-brand-ink sm:text-4xl">
                Sign in to keep your schedule in sync.
              </h1>

              <p className="mt-3 text-sm leading-6 text-brand-ink/65 sm:text-base">
                Keep projects, weekly plans, priorities, and next actions
                available wherever you work.
              </p>

              {!isConfigured ? (
                <div className="mt-5 rounded-[24px] border border-brand-coral/15 bg-brand-coral/8 p-4 text-sm leading-6 text-brand-ink/70">
                  Add `NEXT_PUBLIC_SUPABASE_URL` and
                  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to start using
                  account sync.
                </div>
              ) : null}

              <Button
                aria-label="Continue with Google"
                className="mt-6 w-full border-brand-ink/15 bg-white text-brand-ink shadow-[0_16px_36px_rgba(18,32,47,0.08)] hover:border-brand-ink/25 hover:bg-white"
                disabled={!isConfigured || isSubmitting}
                type="button"
                variant="outline"
                onClick={() => void onSignInWithGoogle()}
              >
                <span className="grid h-6 w-6 place-items-center rounded-full border border-brand-ink/10 bg-white text-sm font-bold text-brand-ink shadow-sm">
                  G
                </span>
                Continue with Google
              </Button>

              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-brand-ink/10" />
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink/40">
                  Or use email
                </span>
                <div className="h-px flex-1 bg-brand-ink/10" />
              </div>

              <div className="grid grid-cols-2 gap-2 rounded-[22px] bg-brand-ink/5 p-1">
                <button
                  type="button"
                  className={cn(
                    "rounded-[18px] px-3 py-2 text-sm font-semibold",
                    authMode === "password"
                      ? "bg-white text-brand-ink shadow-[0_12px_26px_rgba(18,32,47,0.08)]"
                      : "text-brand-ink/65",
                  )}
                  onClick={() => setAuthMode("password")}
                >
                  Email + password
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded-[18px] px-3 py-2 text-sm font-semibold",
                    authMode === "magic-link"
                      ? "bg-white text-brand-ink shadow-[0_12px_26px_rgba(18,32,47,0.08)]"
                      : "text-brand-ink/65",
                  )}
                  onClick={() => setAuthMode("magic-link")}
                >
                  Magic link
                </button>
              </div>

              <form
                className="mt-5 space-y-4 sm:space-y-5"
                onSubmit={(event) => {
                  event.preventDefault();

                  if (authMode === "magic-link") {
                    void onSendMagicLink(email.trim());
                    return;
                  }

                  void onSignInWithPassword(email.trim(), password);
                }}
              >
                <div>
                  <label className="field-label" htmlFor="auth-email">
                    Email
                  </label>
                  <Input
                    id="auth-email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>

                {authMode === "password" ? (
                  <div>
                    <label className="field-label" htmlFor="auth-password">
                      Password
                    </label>
                    <Input
                      id="auth-password"
                      autoComplete="current-password"
                      placeholder="Your password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </div>
                ) : (
                  <div className="rounded-[22px] border border-brand-ocean/12 bg-brand-ocean/8 p-4 text-sm leading-6 text-brand-ink/65">
                    We&apos;ll email you a secure sign-in link. Open it on the
                    device where you want to continue planning.
                  </div>
                )}

                {message ? (
                  <p className="text-sm leading-6 text-brand-teal">{message}</p>
                ) : null}

                {error ? (
                  <p className="text-sm leading-6 text-brand-coral">{error}</p>
                ) : null}

                {authMode === "password" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Button
                      disabled={!isConfigured || !canSubmitPassword || isSubmitting}
                      type="submit"
                    >
                      Sign in
                    </Button>
                    <Button
                      disabled={!isConfigured || !canSubmitPassword || isSubmitting}
                      type="button"
                      variant="outline"
                      onClick={() => void onSignUp(email.trim(), password)}
                    >
                      Create account
                    </Button>
                  </div>
                ) : (
                  <Button
                    className="w-full"
                    disabled={!isConfigured || !canSubmitEmail || isSubmitting}
                    type="submit"
                  >
                    Send magic link
                  </Button>
                )}
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
