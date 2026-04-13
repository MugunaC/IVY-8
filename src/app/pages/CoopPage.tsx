import { Navigate, useLocation } from 'react-router';

export function CoopPage() {
  const location = useLocation();
  return <Navigate to={`/control${location.search}${location.hash}`} replace />;
}
