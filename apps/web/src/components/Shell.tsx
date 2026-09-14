import { Link, useLocation } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import { Wordmark } from './Brand';

export function Shell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const onLibrary = useLocation().pathname === '/';

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-white/8 bg-ink-900/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link to="/" className="shrink-0 transition-opacity hover:opacity-85">
            <Wordmark />
          </Link>

          <span className="hidden h-5 w-px bg-white/12 sm:block" />
          <Link
            to="/"
            className={`hidden rounded-lg px-3 py-1.5 text-sm font-medium transition-colors sm:block ${
              onLibrary ? 'bg-white/8 text-white' : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            Socrates
          </Link>

          <div className="flex-1" />

          {user && (
            <div className="flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <div className="text-sm leading-tight font-medium text-slate-200">
                  {user.name ?? user.email}
                </div>
                <div className="text-[11px] leading-tight text-slate-500">
                  {user.email}
                  {user.via && (
                    <span className="text-slate-600"> · via {user.via}</span>
                  )}
                </div>
              </div>
              {user.picture ? (
                <img
                  src={user.picture}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="h-9 w-9 rounded-full ring-2 ring-white/10"
                />
              ) : (
                <div className="grid h-9 w-9 place-items-center rounded-full bg-ink-700 text-sm font-semibold text-slate-300 ring-2 ring-white/10">
                  {(user.name ?? user.email).charAt(0).toUpperCase()}
                </div>
              )}
              <button onClick={signOut} className="btn-quiet !p-2" title="Sign out" aria-label="Sign out">
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</main>

      <footer className="border-t border-white/6 py-6">
        <div className="mx-auto max-w-6xl px-4 text-center text-xs text-slate-600 sm:px-6">
          Prometheus · Socrates reads and summarizes; the book stays yours.
        </div>
      </footer>
    </div>
  );
}
