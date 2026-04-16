import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/app/context/AuthContext';
import { useTheme } from '@/app/context/ThemeContext';
import { AppShellHeader } from '@/app/components/layout/AppShellHeader';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { enqueueRecord } from '@/app/data/inputStore';
import { appendLog } from '@/app/data/logsRepo';
import { getVehicles, markVehicleInUse, releaseVehicle } from '@/app/data/vehiclesRepo';
import {
  clearLastVehicleSelection,
  getLastVehicleSelection,
  setLastVehicleSelection,
} from '@/app/data/settingsRepo';
import type { Vehicle } from '@shared/types';
import { LogOut, Car, MapPin, Battery, CheckCircle2, Moon, Sun } from 'lucide-react';

export function UserPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const allVehicles = await getVehicles();
      const userVehicles = allVehicles.filter((v) =>
        v.assignedUsers.includes(user.id)
      );
      setVehicles(userVehicles);

      const resumeVehicle = userVehicles.find(
        (v) => v.currentUserId === user.id || v.currentUser === user.username
      );
      if (resumeVehicle) {
        setSelectedVehicle(resumeVehicle.id);
        return;
      }

      const storedSelection = user.id
        ? getLastVehicleSelection(user.id)
        : null;
      if (storedSelection && userVehicles.some((v) => v.id === storedSelection)) {
        setSelectedVehicle(storedSelection);
      }
    };

    void load();
  }, [user]);

  const handleSelectVehicle = async (vehicleId: string) => {
    const vehicle = vehicles.find((v) => v.id === vehicleId);
    if (!vehicle || !user) return;
    const isResume = vehicle.status === 'unavailable' &&
      (vehicle.currentUserId === user.id || vehicle.currentUser === user.username);
    if (!isResume && vehicle.status !== 'available') return;

    const updatedAll = isResume
      ? await getVehicles()
      : await markVehicleInUse(vehicleId, user.username, user.id);

    const timestamp = new Date().toISOString();
    void appendLog({
      id: `log-${Date.now()}`,
      userId: user.id,
      username: user.username,
      action: isResume ? 'vehicle_resumed' : 'vehicle_selected',
      details: `${isResume ? 'Resumed' : 'Selected'} vehicle ${vehicle.model} (${vehicleId})`,
      timestamp,
    });
    void enqueueRecord({
      ts: Date.now(),
      userId: user.id,
      username: user.username,
      vehicleId,
      action: isResume ? 'vehicle_resumed' : 'vehicle_selected',
      details: `${isResume ? 'Resumed' : 'Selected'} vehicle ${vehicle.model} (${vehicleId})`,
    });

    setSelectedVehicle(vehicleId);
    setLastVehicleSelection(user.id, vehicleId);

    const nextUserVehicles = updatedAll.filter((v) => v.assignedUsers.includes(user.id));
    setVehicles(nextUserVehicles);
  };

  const handleUnselectVehicle = async () => {
    if (!selectedVehicle || !user) return;

    const vehicle = vehicles.find((v) => v.id === selectedVehicle);
    try {
      const updatedAll = await releaseVehicle(selectedVehicle);
      const timestamp = new Date().toISOString();
      void appendLog({
        id: `log-${Date.now()}`,
        userId: user.id,
        username: user.username,
        action: 'vehicle_unselected',
        details: `Unselected vehicle ${vehicle?.model} (${selectedVehicle})`,
        timestamp,
      });
      void enqueueRecord({
        ts: Date.now(),
        userId: user.id,
        username: user.username,
        vehicleId: selectedVehicle,
        action: 'vehicle_unselected',
        details: `Unselected vehicle ${vehicle?.model} (${selectedVehicle})`,
      });
      setVehicles(updatedAll.filter((v) => v.assignedUsers.includes(user.id)));
    } finally {
      setSelectedVehicle(null);
      clearLastVehicleSelection(user.id);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const handleProceed = () => {
    if (selectedVehicle) {
      const vehicle = vehicles.find((v) => v.id === selectedVehicle);
      navigate('/control', { state: { vehicle } });
    }
  };

  return (
    <div className="app-shell min-h-screen">
      <AppShellHeader
        title="IVY"
        subtitle={`Welcome, ${user?.username ?? ''}`}
        actions={
          <>
            <Button onClick={toggleTheme} variant="outline" size="icon" className="app-header-action">
              {theme === 'light' ? <Moon className="size-4" /> : <Sun className="size-4" />}
            </Button>
            <Button onClick={handleLogout} variant="outline" className="app-header-action">
              <LogOut className="size-4 mr-2" />
              Logout
            </Button>
          </>
        }
      />

      <main className="container mx-auto px-4 py-6 max-w-6xl">
        <section className="app-hero relative overflow-hidden mb-6 p-6">
          <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.24),transparent_58%)]" />
          <div className="relative flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-3xl font-semibold text-[color:var(--app-hero-foreground)]">Select Your Vehicle</h2>
              <p className="mt-2 text-sm text-[color:var(--app-hero-muted)]">
                Choose an available vehicle from your assigned list to proceed
              </p>
            </div>
            <div className="rounded-2xl border border-[color:var(--app-hero-chip-border)] bg-[color:var(--app-hero-chip-bg)] px-4 py-3 text-sm text-[color:var(--app-hero-foreground)]">
              {vehicles.length} assigned vehicle{vehicles.length === 1 ? '' : 's'}
            </div>
          </div>
        </section>

        {vehicles.length === 0 ? (
          <Card className="app-panel">
            <CardContent className="py-12 text-center">
              <Car className="size-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No vehicles have been assigned to you yet.</p>
              <p className="text-sm text-muted-foreground mt-2">
                Please contact an administrator to assign vehicles.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {vehicles.map((vehicle) => {
                const isSelected = selectedVehicle === vehicle.id;
                const isAvailable = vehicle.status === 'available';
                const isCurrentUserVehicle = vehicle.currentUser === user?.username;
                const canSelect = isAvailable || (isCurrentUserVehicle && vehicle.status === 'unavailable');

                return (
                  <Card
                    key={vehicle.id}
                    className={`transition-all ${
                      isSelected
                        ? 'app-panel ring-2 ring-sky-400/60 border-sky-400/45'
                        : canSelect
                        ? 'app-panel cursor-pointer hover:-translate-y-0.5 hover:border-sky-300/40'
                        : 'app-panel opacity-60'
                    }`}
                    onClick={() => {
                      if (canSelect) {
                        void handleSelectVehicle(vehicle.id);
                      }
                    }}
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="flex items-center gap-2">
                            <Car className="size-5" />
                            {vehicle.model}
                          </CardTitle>
                          <CardDescription className="mt-1">
                            ID: {vehicle.id}
                          </CardDescription>
                        </div>
                        {isSelected && (
                          <CheckCircle2 className="size-6 text-primary" />
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Status</span>
                        <Badge
                          variant={
                            vehicle.status === 'available'
                              ? 'default'
                              : vehicle.status === 'unavailable'
                              ? 'secondary'
                              : 'destructive'
                          }
                        >
                          {isCurrentUserVehicle && vehicle.status === 'unavailable'
                            ? 'resume'
                            : vehicle.status}
                        </Badge>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Condition</span>
                        <span className="text-sm font-medium">{vehicle.condition}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <MapPin className="size-4 text-muted-foreground" />
                        <span className="text-sm">{vehicle.location}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <Battery className="size-4 text-muted-foreground" />
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm text-muted-foreground">Charge</span>
                            <span className="text-sm font-medium">{vehicle.charge}%</span>
                          </div>
                          <div className="w-full bg-muted rounded-full h-2">
                            <div
                              className={`h-2 rounded-full ${
                                vehicle.charge > 60
                                  ? 'bg-green-500'
                                  : vehicle.charge > 30
                                  ? 'bg-yellow-500'
                                  : 'bg-red-500'
                              }`}
                              style={{ width: `${vehicle.charge}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      {vehicle.currentUser && !isCurrentUserVehicle && (
                        <div className="text-sm text-muted-foreground mt-2 pt-2 border-t">
                          Currently in use by: {vehicle.currentUser}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {selectedVehicle && (
              <div className="app-panel flex items-center justify-between gap-4 p-4">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="size-6 text-sky-600" />
                  <div>
                    <p className="font-medium">
                      Vehicle Selected:{' '}
                      {vehicles.find((v) => v.id === selectedVehicle)?.model}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      You can now proceed to the next step
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => void handleUnselectVehicle()}>
                    End Session
                  </Button>
                  <Button onClick={handleProceed}>Proceed</Button>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
