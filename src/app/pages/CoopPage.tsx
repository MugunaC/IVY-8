import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/app/context/AuthContext';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Input } from '@/app/components/ui/input';
import { getVehicles } from '@/app/data/vehiclesRepo';
import type { Vehicle } from '@shared/types';

function createSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().slice(0, 8);
  }
  return `coop-${Math.random().toString(36).slice(2, 10)}`;
}

export function CoopPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const initialVehicleId = useMemo(() => new URLSearchParams(location.search).get('vehicleId') || '', [location.search]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [createVehicleId, setCreateVehicleId] = useState('');
  const [joinSessionId, setJoinSessionId] = useState('');
  const [joinVehicleId, setJoinVehicleId] = useState('');

  useEffect(() => {
    let mounted = true;
    void getVehicles()
      .then((items) => {
        if (!mounted) return;
        setVehicles(items);
        const preferredVehicleId = items.some((vehicle) => vehicle.id === initialVehicleId)
          ? initialVehicleId
          : items[0]?.id || '';
        setCreateVehicleId(preferredVehicleId);
        setJoinVehicleId(preferredVehicleId);
      })
      .catch(() => {
        if (!mounted) return;
        setVehicles([]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [initialVehicleId]);

  const vehicleOptions = useMemo(
    () =>
      vehicles.map((vehicle) => ({
        id: vehicle.id,
        label: `${vehicle.model} (${vehicle.id})`,
      })),
    [vehicles]
  );

  const handleCreate = () => {
    const sessionId = createSessionId();
    const params = new URLSearchParams();
    if (createVehicleId) params.set('vehicleId', createVehicleId);
    navigate(`/coop/session/${encodeURIComponent(sessionId)}?${params.toString()}`);
  };

  const handleJoin = (role: 'driver' | 'spectator') => {
    const sessionId = joinSessionId.trim();
    if (!sessionId) return;
    const params = new URLSearchParams();
    params.set('role', role);
    if (joinVehicleId && role !== 'spectator') params.set('vehicleId', joinVehicleId);
    navigate(`/coop/session/${encodeURIComponent(sessionId)}?${params.toString()}`);
  };

  return (
    <main className="container mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Coop</div>
        <h1 className="text-3xl font-bold tracking-tight">Shared Mission Sessions</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Create a shared map session, invite operators or spectators, and keep planning state synchronized without coupling everyone to one camera.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border/70 bg-card/90">
          <CardHeader>
            <CardTitle className="text-base">Start Session</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="text-sm text-muted-foreground">Signed in as {user?.username || 'unknown user'}</div>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Vehicle</span>
              <select
                value={createVehicleId}
                onChange={(event) => setCreateVehicleId(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3"
                disabled={loading || vehicleOptions.length === 0}
              >
                {vehicleOptions.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.label}
                  </option>
                ))}
              </select>
            </label>
            <Button onClick={handleCreate} disabled={loading || !createVehicleId}>
              Start Coop Session
            </Button>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/90">
          <CardHeader>
            <CardTitle className="text-base">Join Session</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Session Code</span>
              <Input value={joinSessionId} onChange={(event) => setJoinSessionId(event.target.value)} placeholder="e.g. a1b2c3d4" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Vehicle For Driver Role</span>
              <select
                value={joinVehicleId}
                onChange={(event) => setJoinVehicleId(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3"
                disabled={loading || vehicleOptions.length === 0}
              >
                {vehicleOptions.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => handleJoin('driver')} disabled={!joinSessionId.trim()}>
                Join As Participant
              </Button>
              <Button variant="outline" onClick={() => handleJoin('spectator')} disabled={!joinSessionId.trim()}>
                Join As Spectator
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
