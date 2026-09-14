import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { Shell } from './components/Shell';
import { Spinner } from './components/Bits';
import { Login } from './pages/Login';
import { Library } from './pages/Library';
import { Reader } from './pages/Reader';
import { Admin } from './pages/Admin';

function Routed() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner label="Checking your session…" />
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/book/:id" element={<Reader />} />
        <Route path="/book/:id/:tab" element={<Reader />} />
        {/* Rendered for everyone who asks; the API refuses non-admins, so the
            page simply shows that refusal rather than pretending to be secret. */}
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

export default function App() {
  // HashRouter, not BrowserRouter: GitHub Pages serves static files with no
  // rewrite rule, so a deep link like /prometheus/book/xyz would 404 on reload.
  return (
    <HashRouter>
      <AuthProvider>
        <Routed />
      </AuthProvider>
    </HashRouter>
  );
}
