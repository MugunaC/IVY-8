import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, useLocation, useParams } from 'react-router';
import { useAuth } from '@/app/context/AuthContext';
import { getHomeRoute } from '@/app/utils/navigation';

const LoginPage = lazy(async () => {
  const mod = await import('@/app/pages/LoginPage');
  return { default: mod.LoginPage };
});
const AdminDashboard = lazy(async () => {
  const mod = await import('@/app/pages/AdminDashboard');
  return { default: mod.AdminDashboard };
});
const UserPage = lazy(async () => {
  const mod = await import('@/app/pages/UserPage');
  return { default: mod.UserPage };
});
const ControllerPage = lazy(async () => {
  const mod = await import('@/app/pages/ControllerPage');
  return { default: mod.ControllerPage };
});
function OpsRedirect() {
  const location = useLocation();
  return <Navigate to={`/control${location.search}${location.hash}`} replace />;
}

function CoopRedirect() {
  const location = useLocation();
  return <Navigate to={`/control${location.search}${location.hash}`} replace />;
}

function CoopSessionRedirect() {
  const location = useLocation();
  const params = useParams();
  const search = new URLSearchParams(location.search);
  if (params.sessionId) {
    search.set('session', params.sessionId);
  }
  return <Navigate to={`/control?${search.toString()}${location.hash}`} replace />;
}

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      Loading...
    </div>
  );
}

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) {
    const redirect = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/?redirect=${encodeURIComponent(redirect)}`} replace />;
  }
  return children;
}

function RequireRole({ role, children }: { role: 'admin' | 'user'; children: JSX.Element }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) {
    const redirect = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/?redirect=${encodeURIComponent(redirect)}`} replace />;
  }
  if (user.role !== role) {
    return <Navigate to={getHomeRoute(user.role)} replace />;
  }
  return children;
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <Suspense fallback={<RouteFallback />}>
        <LoginPage />
      </Suspense>
    ),
  },
  {
    path: '/admin',
    element: (
      <RequireRole role="admin">
        <Suspense fallback={<RouteFallback />}>
          <AdminDashboard />
        </Suspense>
      </RequireRole>
    ),
  },
  {
    path: '/user',
    element: (
      <RequireRole role="user">
        <Suspense fallback={<RouteFallback />}>
          <UserPage />
        </Suspense>
      </RequireRole>
    ),
  },
  {
    path: '/control',
    element: (
      <RequireAuth>
        <Suspense fallback={<RouteFallback />}>
          <ControllerPage />
        </Suspense>
      </RequireAuth>
    ),
  },
  {
    path: '/coop',
    element: (
      <RequireAuth>
        <CoopRedirect />
      </RequireAuth>
    ),
  },
  {
    path: '/coop/session/:sessionId',
    element: (
      <RequireAuth>
        <CoopSessionRedirect />
      </RequireAuth>
    ),
  },
  {
    path: '/ops',
    element: (
      <RequireAuth>
        <OpsRedirect />
      </RequireAuth>
    ),
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
]);
