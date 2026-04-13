import { Navigate, useLocation, useParams } from 'react-router';

export function CoopSessionPage() {
  const location = useLocation();
  const params = useParams();
  const search = new URLSearchParams(location.search);
  if (params.sessionId) {
    search.set('session', params.sessionId);
  }
  return <Navigate to={`/control?${search.toString()}${location.hash}`} replace />;
}
