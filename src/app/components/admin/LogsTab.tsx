import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/app/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/app/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/app/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select';
import { Input } from '@/app/components/ui/input';
import { ChevronLeft, ChevronRight, FileText, Filter, RefreshCw, Settings, Trash2 } from 'lucide-react';
import type { ActivityLog, ActivityLogStats } from '@shared/types';
import { clearLogs, queryLogs } from '@/app/data/logsRepo';

export function LogsTab() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [stats, setStats] = useState<ActivityLogStats>({
    login: 0,
    logout: 0,
    vehicle_selected: 0,
    vehicle_unselected: 0,
    vehicle_resumed: 0,
  });
  const [actionTypes, setActionTypes] = useState<ActivityLog['action'][]>([]);
  const [filterAction, setFilterAction] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [page, setPage] = useState(1);
  const [totalLogs, setTotalLogs] = useState(0);
  const pageSize = 10;

  const loadLogs = useCallback(async () => {
    const result = await queryLogs({
      page,
      pageSize,
      action: filterAction as ActivityLog['action'] | 'all',
      q: query.trim() || undefined,
    });
    setLogs(result.items);
    setStats(result.stats);
    setActionTypes(result.availableActions);
    setTotalLogs(result.total);
  }, [filterAction, page, query]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    setPage(1);
  }, [filterAction, query]);

  const handleClearLogs = async () => {
    if (confirm('Are you sure you want to clear all logs? This action cannot be undone.')) {
      await clearLogs();
      setLogs([]);
      setTotalLogs(0);
    }
  };

  const getActionBadge = (action: string) => {
    const styles: Record<string, string> = {
      login: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      logout: 'border-rose-400/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
      vehicle_selected: 'border-sky-400/35 bg-sky-500/10 text-sky-700 dark:text-sky-300',
      vehicle_unselected: 'border-violet-400/35 bg-violet-500/10 text-violet-700 dark:text-violet-300',
      vehicle_resumed: 'border-amber-400/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    };

    const className = styles[action] || 'border-border/70 bg-muted/30 text-foreground';

    return (
      <span
        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${className}`}
      >
        {action.replace('_', ' ')}
      </span>
    );
  };

  const totalPages = Math.max(1, Math.ceil(totalLogs / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = totalLogs === 0 ? 0 : (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + logs.length, totalLogs);

  useEffect(() => {
    if (page !== safePage) {
      setPage(safePage);
    }
  }, [page, safePage]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Activity Logs</CardTitle>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="sm:h-8 sm:w-auto sm:px-3"
              onClick={() => void loadLogs()}
              aria-label="Refresh logs"
              title="Refresh logs"
            >
              <RefreshCw className="size-4" />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="sm:h-8 sm:w-auto sm:px-3"
              onClick={() => void handleClearLogs()}
              aria-label="Clear logs"
              title="Clear logs"
            >
              <Trash2 className="size-4" />
              <span className="hidden sm:inline">Clear Logs</span>
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="sm:h-8 sm:w-auto sm:px-3"
              onClick={() => setShowSettings((prev) => !prev)}
              aria-pressed={showSettings}
              aria-label="Log settings"
              title="Log settings"
            >
              <Settings className="size-4" />
              <span className="hidden sm:inline">Settings</span>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {showSettings && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="app-panel-muted p-4">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border/70 bg-background/65">
                    <Filter className="size-4 text-muted-foreground" />
                  </span>
                  <span className="text-sm font-medium">Filters</span>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3">
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">Search</div>
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search user, action, or details"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">Filter by Action</div>
                    <Select value={filterAction} onValueChange={setFilterAction}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Actions</SelectItem>
                        {actionTypes.map((action) => (
                          <SelectItem key={action} value={action}>
                            {action.replace('_', ' ')}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="min-w-0">
            <Table className="min-w-[920px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">No.</TableHead>
                  <TableHead>Log ID</TableHead>
                  <TableHead>User ID</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Timestamp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-12 text-center text-muted-foreground"
                    >
                      <FileText className="mx-auto mb-2 size-12 text-muted-foreground" />
                      No activity logs found
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log, index) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {startIndex + index + 1}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{log.id}</TableCell>
                      <TableCell className="font-mono text-sm">
                        {log.userId}
                      </TableCell>
                      <TableCell className="font-medium">{log.username}</TableCell>
                      <TableCell>{getActionBadge(log.action)}</TableCell>
                      <TableCell className="max-w-md truncate text-sm">
                        {log.details || '-'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {new Date(log.timestamp).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <div>
              {totalLogs === 0 ? '0-0 of 0' : `${startIndex + 1}-${endIndex} of ${totalLogs}`}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={safePage <= 1}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={safePage >= totalPages}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t pt-4 md:grid-cols-4">
            <div className="app-panel-muted p-4">
              <div className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Logins</div>
              <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">
                {stats.login}
              </div>
            </div>
            <div className="app-panel-muted p-4">
              <div className="text-sm font-medium text-rose-700 dark:text-rose-300">Logouts</div>
              <div className="text-2xl font-bold text-rose-700 dark:text-rose-300">
                {stats.logout}
              </div>
            </div>
            <div className="app-panel-muted p-4">
              <div className="text-sm font-medium text-sky-700 dark:text-sky-300">
                Vehicles Selected
              </div>
              <div className="text-2xl font-bold text-sky-700 dark:text-sky-300">
                {stats.vehicle_selected}
              </div>
            </div>
            <div className="app-panel-muted p-4">
              <div className="text-sm font-medium text-violet-700 dark:text-violet-300">
                Vehicles Unselected
              </div>
              <div className="text-2xl font-bold text-violet-700 dark:text-violet-300">
                {stats.vehicle_unselected}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
