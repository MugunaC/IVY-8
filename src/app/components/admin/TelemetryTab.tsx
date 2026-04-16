import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/app/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/app/components/ui/card';
import { Input } from '@/app/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/app/components/ui/table';
import {
  exportTelemetryCsv,
  getRecentTelemetry,
  getTelemetryStats,
  type TelemetryFilter,
} from '@/app/data/inputStore';
import { getVehicles } from '@/app/data/vehiclesRepo';
import type { TelemetryEntry, User, Vehicle } from '@shared/types';
import { Database, Download, Filter, RefreshCw, Settings } from 'lucide-react';
import { getUsers } from '@/app/data/usersRepo';

export function TelemetryTab() {
  const [entries, setEntries] = useState<TelemetryEntry[]>([]);
  const [stats, setStats] = useState({ bytes: 0, count: 0 });
  const [limit, setLimit] = useState(200);
  const [userFilter, setUserFilter] = useState('all');
  const [vehicleFilter, setVehicleFilter] = useState('');
  const [leaseFilter, setLeaseFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  const vehicleOptions = useMemo(() => {
    const values = new Set<string>();
    vehicles.forEach((vehicle) => {
      values.add(vehicle.model);
    });
    return Array.from(values);
  }, [vehicles]);

  const resolveVehicleId = useCallback((input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return undefined;
    const byId = vehicles.find((vehicle) => vehicle.id.toLowerCase() === trimmed.toLowerCase());
    if (byId) return byId.id;
    const byModel = vehicles.find((vehicle) => vehicle.model.toLowerCase() === trimmed.toLowerCase());
    if (byModel) return byModel.id;
    const comboMatch = trimmed.match(/\(([^)]+)\)\s*$/);
    if (comboMatch) {
      const candidate = comboMatch[1];
      const byCombo = vehicles.find((vehicle) => vehicle.id.toLowerCase() === candidate.toLowerCase());
      if (byCombo) return byCombo.id;
    }
    return trimmed;
  }, [vehicles]);

  const getFilters = useCallback((): TelemetryFilter => {
    const startTs = startDate ? new Date(`${startDate}T00:00:00`).getTime() : undefined;
    const endTs = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : undefined;
    return {
      limit,
      userId: userFilter === 'all' ? undefined : userFilter,
      vehicleId: resolveVehicleId(vehicleFilter),
      leaseId: leaseFilter.trim() || undefined,
      startTs: Number.isFinite(startTs || 0) ? startTs : undefined,
      endTs: Number.isFinite(endTs || 0) ? endTs : undefined,
    };
  }, [endDate, leaseFilter, limit, resolveVehicleId, startDate, userFilter, vehicleFilter]);

  const filterSummary = useMemo(() => {
    const parts: string[] = [`Samples = ${limit}`];
    if (userFilter !== 'all') {
      const user = users.find((item) => item.id === userFilter);
      parts.push(`user=${user?.username || userFilter}`);
    }
    if (vehicleFilter.trim()) {
      const resolved = resolveVehicleId(vehicleFilter);
      parts.push(`vehicle=${resolved || vehicleFilter.trim()}`);
    }
    if (leaseFilter.trim()) {
      parts.push(`lease=${leaseFilter.trim()}`);
    }
    if (startDate) {
      parts.push(`start=${startDate}`);
    }
    if (endDate) {
      parts.push(`end=${endDate}`);
    }
    return parts.join(' | ');
  }, [endDate, leaseFilter, limit, resolveVehicleId, startDate, userFilter, users, vehicleFilter]);

  const formatBytes = (bytes: number) => {
    if (!bytes) return '0 MB';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };

  const loadTelemetry = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const filters = getFilters();
      const [recent, stat] = await Promise.all([
        getRecentTelemetry(filters),
        getTelemetryStats(filters),
      ]);
      setEntries(recent);
      setStats(stat);
    } catch (err) {
      console.warn(err);
      setError('Failed to load input.');
    } finally {
      setLoading(false);
    }
  }, [getFilters]);

  useEffect(() => {
    void loadTelemetry();
  }, [loadTelemetry]);

  useEffect(() => {
    void getUsers().then(setUsers).catch(() => setUsers([]));
    void getVehicles().then(setVehicles).catch(() => setVehicles([]));
  }, []);

  const handleExport = async () => {
    setError('');
    const csv = await exportTelemetryCsv(getFilters());
    if (!csv) {
      setError('No input data available to export.');
      return;
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `input-${new Date().toISOString()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <Database className="size-5" />
              Input
            </CardTitle>
            <CardDescription className="truncate">{filterSummary}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="sm:h-8 sm:w-auto sm:px-3"
              onClick={() => void loadTelemetry()}
              disabled={loading}
              aria-label="Refresh input"
              title="Refresh input"
            >
              <RefreshCw className="size-4" />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="sm:h-8 sm:w-auto sm:px-3"
              onClick={handleExport}
              aria-label="Export input as CSV"
              title="Export input as CSV"
            >
              <Download className="size-4" />
              <span className="hidden sm:inline">Export CSV</span>
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="sm:h-8 sm:w-auto sm:px-3"
              onClick={() => setShowSettings((prev) => !prev)}
              aria-pressed={showSettings}
              aria-label="Input settings"
              title="Input settings"
            >
              <Settings className="size-4" />
              <span className="hidden sm:inline">Settings</span>
            </Button>
          </div>
        </div>

        {showSettings && (
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="app-panel-muted p-4">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border/70 bg-background/65">
                  <Filter className="size-4 text-muted-foreground" />
                </span>
                <span className="text-sm font-medium">Filters</span>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3">
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">Filter by User</div>
                  <select
                    className="h-10 w-full rounded-xl border border-input/80 bg-input-background/95 px-3 py-2 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] outline-none backdrop-blur"
                    value={userFilter}
                    onChange={(event) => setUserFilter(event.target.value)}
                  >
                    <option value="all">All users</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.username} ({user.id})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">Start Date</div>
                    <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">End Date</div>
                    <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">Filter by Vehicle</div>
                    <Input
                      list="telemetry-vehicle-options"
                      value={vehicleFilter}
                      onChange={(event) => setVehicleFilter(event.target.value)}
                      placeholder="Type name or ID"
                    />
                    <datalist id="telemetry-vehicle-options">
                      {vehicleOptions.map((option) => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">Filter by Lease ID</div>
                    <Input
                      value={leaseFilter}
                      onChange={(event) => setLeaseFilter(event.target.value)}
                      placeholder="lease-uuid"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button variant="outline" onClick={() => void loadTelemetry()} disabled={loading}>
                    Apply Filters
                  </Button>
                </div>
              </div>
            </div>

            <div className="app-panel-muted p-4">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border/70 bg-background/65">
                  <Database className="size-4 text-muted-foreground" />
                </span>
                <span className="text-sm font-medium">Stored Samples</span>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3">
                <div className="app-panel-muted p-3">
                  <div className="text-xs text-muted-foreground">Stored Samples</div>
                  <div className="text-xl font-semibold">{stats.count}</div>
                </div>
                <div className="app-panel-muted p-3">
                  <div className="text-xs text-muted-foreground">Storage Used</div>
                  <div className="text-xl font-semibold">{formatBytes(stats.bytes)}</div>
                </div>
                <div className="app-panel-muted p-3">
                  <div className="text-xs text-muted-foreground">Load Limit</div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={50}
                      max={5000}
                      value={limit}
                      onChange={(event) => setLimit(Number(event.target.value) || 200)}
                    />
                    <Button variant="outline" onClick={() => void loadTelemetry()} disabled={loading}>
                      Apply
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 min-w-0">
          <Table className="min-w-[980px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">No.</TableHead>
                <TableHead>Timestamp</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Lease</TableHead>
                <TableHead>Buttons</TableHead>
                <TableHead>Axes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                    No input records found
                  </TableCell>
                </TableRow>
              ) : (
                entries.map((entry, index) => (
                  <TableRow key={entry.id || entry.ts}>
                    <TableCell className="text-xs text-muted-foreground">{index + 1}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {new Date(entry.ts).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-xs">
                      {entry.userId || '-'}
                    </TableCell>
                    <TableCell className="text-xs">
                      {entry.vehicleId || '-'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {entry.payload.leaseId ? `${entry.payload.leaseId.slice(0, 8)}...` : '-'}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-xs">
                      {entry.payload.buttons.map((value) => value.toFixed(2)).join(', ')}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-xs">
                      {entry.payload.axes.map((value) => value.toFixed(2)).join(', ')}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="text-sm text-red-500">{error}</div>
        )}
      </CardContent>
    </Card>
  );
}
