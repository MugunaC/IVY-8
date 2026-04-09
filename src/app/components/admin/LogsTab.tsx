import { useState, useEffect } from 'react';
import { Button } from '@/app/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
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
import { ChevronLeft, ChevronRight, FileText, Filter, RefreshCw, Settings, Trash2 } from 'lucide-react';
import type { ActivityLog } from '@shared/types';
import { clearLogs, getLogs } from '@/app/data/logsRepo';

export function LogsTab() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [filterAction, setFilterAction] = useState<string>('all');
  const [showSettings, setShowSettings] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    void loadLogs();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [filterAction]);

  const loadLogs = async () => {
    const parsedLogs = await getLogs();
    parsedLogs.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    setLogs(parsedLogs);
  };

  const handleClearLogs = async () => {
    if (confirm('Are you sure you want to clear all logs? This action cannot be undone.')) {
      await clearLogs();
      setLogs([]);
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

  const filteredLogs =
    filterAction === 'all'
      ? logs
      : logs.filter((log) => log.action === filterAction);

  const actionTypes = Array.from(new Set(logs.map((log) => log.action)));
  const totalLogs = filteredLogs.length;
  const totalPages = Math.max(1, Math.ceil(totalLogs / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalLogs);
  const pageLogs = filteredLogs.slice(startIndex, endIndex);

  useEffect(() => {
    if (page !== safePage) {
      setPage(safePage);
    }
  }, [page, safePage]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Activity Logs</CardTitle>
            <CardDescription>
              View all user activity and system events
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadLogs()}>
              <RefreshCw className="size-4 mr-2" />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => void handleClearLogs()}>
              <Trash2 className="size-4 mr-2" />
              Clear Logs
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSettings((prev) => !prev)}
              aria-pressed={showSettings}
            >
              <Settings className="size-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {showSettings && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="app-panel-muted group p-4 transition-all duration-200 hover:border-border/90">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border/70 bg-background/65">
                    <Filter className="size-4 text-muted-foreground" />
                  </span>
                  <span className="sr-only">Filters</span>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 overflow-hidden max-h-0 group-hover:max-h-[220px] transition-all duration-300">
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

          <div>
            <Table>
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
                {pageLogs.length === 0 ? (
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
                  pageLogs.map((log, index) => (
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
                      <TableCell className="text-sm max-w-md truncate">
                        {log.details || '-'}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
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

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t">
            <div className="app-panel-muted p-4">
              <div className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Logins</div>
              <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">
                {logs.filter((log) => log.action === 'login').length}
              </div>
            </div>
            <div className="app-panel-muted p-4">
              <div className="text-sm font-medium text-rose-700 dark:text-rose-300">Logouts</div>
              <div className="text-2xl font-bold text-rose-700 dark:text-rose-300">
                {logs.filter((log) => log.action === 'logout').length}
              </div>
            </div>
            <div className="app-panel-muted p-4">
              <div className="text-sm font-medium text-sky-700 dark:text-sky-300">
                Vehicles Selected
              </div>
              <div className="text-2xl font-bold text-sky-700 dark:text-sky-300">
                {logs.filter((log) => log.action === 'vehicle_selected').length}
              </div>
            </div>
            <div className="app-panel-muted p-4">
              <div className="text-sm font-medium text-violet-700 dark:text-violet-300">
                Vehicles Unselected
              </div>
              <div className="text-2xl font-bold text-violet-700 dark:text-violet-300">
                {logs.filter((log) => log.action === 'vehicle_unselected').length}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

