import { useEffect, useRef, useState } from 'react';
import { BookOpen, Sparkles } from 'lucide-react';
import { GOOGLE_CLIENT_ID } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Flame } from '../components/Brand';
import { ErrorNote } from '../components/Bits';

export function Login() {
  const { signIn } = useAuth();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) {
      setError('VITE_GOOGLE_CLIENT_ID is not set in this build, so sign-in cannot start.');
      return;
    }

    // The GIS script is async; poll briefly until it has defined window.google.
    let cancelled = false;
    const start = () => {
      if (cancelled || !window.google || !buttonRef.current) return false;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        cancel_on_tap_outside: false,
        callback: ({ credential }) => {
          if (!credential) {
            setError('Google returned no credential. Try again, or use a different browser.');
            return;
          }
          setBusy(true);
          setError(null);
          console.info('[prometheus] Google returned a credential; verifying with the API…');
          signIn(credential)
            .then(() => console.info('[prometheus] Signed in.'))
            .catch((err: Error) => {
              console.error('[prometheus] Sign-in failed:', err);
              setError(err.message);
            })
            .finally(() => setBusy(false));
        },
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        type: 'standard',
        theme: 'filled_black',
        size: 'large',
        text: 'continue_with',
        shape: 'pill',
        width: 280,
        logo_alignment: 'left',
      });
      return true;
    };

    if (start()) return;
    const timer = setInterval(() => start() && clearInterval(timer), 120);
    const giveUp = setTimeout(() => {
      clearInterval(timer);
      if (!cancelled && !window.google) {
        setError('Google sign-in did not load. A content blocker may be blocking accounts.google.com.');
      }
    }, 8000);

    return () => {
      cancelled = true;
      clearInterval(timer);
      clearTimeout(giveUp);
    };
  }, [signIn]);

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="rise w-full max-w-md">
        <div className="mb-9 text-center">
          <Flame className="mx-auto mb-5 h-14 w-14 drop-shadow-[0_0_28px_rgba(237,143,46,0.5)]" />
          <h1 className="font-serif text-4xl font-semibold tracking-tight text-white">Prometheus</h1>
          <p className="mt-2.5 text-sm text-slate-400">A private workshop for a few good tools.</p>
        </div>

        <div className="panel px-7 py-8">
          <div className="flex min-h-[44px] items-center justify-center">
            {busy ? (
              <div className="flex items-center gap-2.5 text-sm text-slate-400">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-ember-500 border-t-transparent" />
                Verifying with Google…
              </div>
            ) : (
              /* Google renders its button inside an iframe with its own opaque
                 backdrop, which shows as a pale rectangle behind the pill.
                 Clipping to the same rounded shape hides the corners the
                 iframe leaves behind. */
              <div className="flex overflow-hidden rounded-full">
                <div ref={buttonRef} />
              </div>
            )}
          </div>

          {error && (
            <div className="mt-6">
              <ErrorNote>{error}</ErrorNote>
            </div>
          )}
        </div>

        <div className="mt-8 space-y-3">
          <p className="text-center text-[11px] font-semibold tracking-[0.16em] text-slate-600 uppercase">
            Inside
          </p>
          <div className="panel flex items-start gap-3.5 p-4">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sage-500/12">
              <BookOpen className="h-5 w-5 text-sage-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white">Socrates</span>
                <Sparkles className="h-3 w-3 text-ember-400" />
              </div>
              <p className="mt-0.5 text-[13px] leading-relaxed text-slate-500">
                Upload a book, get a structured summary, keep both to read later.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
