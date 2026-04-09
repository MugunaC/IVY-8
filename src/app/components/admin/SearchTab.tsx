import { useState } from 'react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/app/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/app/components/ui/table';
import { Search, Database } from 'lucide-react';
import { searchRecords, type SearchCategory } from '@/app/data/searchRepo';

export function SearchTab() {
  const [searchCategory, setSearchCategory] = useState<SearchCategory>('users');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = async () => {
    setHasSearched(true);
    const results = await searchRecords(searchCategory, searchQuery, 100);
    setSearchResults(results);
  };

  const renderResultsTable = () => {
    if (!hasSearched) {
      return (
        <div className="py-12 text-center text-muted-foreground">
          <Database className="mx-auto mb-4 size-12 text-muted-foreground" />
          <p>Enter search criteria and click Search to view results</p>
        </div>
      );
    }

    if (searchResults.length === 0) {
      return (
        <div className="py-12 text-center text-muted-foreground">
          <Search className="mx-auto mb-4 size-12 text-muted-foreground" />
          <p>
            No results found for &quot;{searchQuery}&quot;
          </p>
        </div>
      );
    }

    switch (searchCategory) {
      case 'users':
        return (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User ID</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Created At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {searchResults.map((user: any) => (
                <TableRow key={user.id}>
                  <TableCell className="font-mono text-sm">{user.id}</TableCell>
                  <TableCell className="font-medium">{user.username}</TableCell>
                  <TableCell>{user.email || '-'}</TableCell>
                  <TableCell>{user.role}</TableCell>
                  <TableCell>
                    {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        );

      case 'vehicles':
        return (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vehicle ID</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Charge</TableHead>
                <TableHead>Assigned Users</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {searchResults.map((vehicle: any) => (
                <TableRow key={vehicle.id}>
                  <TableCell className="font-mono text-sm">{vehicle.id}</TableCell>
                  <TableCell className="font-medium">{vehicle.model}</TableCell>
                  <TableCell>{vehicle.status}</TableCell>
                  <TableCell>{vehicle.condition}</TableCell>
                  <TableCell>{vehicle.location}</TableCell>
                  <TableCell>{vehicle.charge}%</TableCell>
                  <TableCell>{vehicle.assignedUsers.length} user(s)</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        );

      case 'logs':
        return (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Log ID</TableHead>
                <TableHead>User ID</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>Timestamp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {searchResults.map((log: any) => (
                <TableRow key={log.id}>
                  <TableCell className="font-mono text-sm">{log.id}</TableCell>
                  <TableCell className="font-mono text-sm">{log.userId}</TableCell>
                  <TableCell className="font-medium">{log.username}</TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                        log.action === 'login'
                          ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : log.action === 'logout'
                          ? 'border-rose-400/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                          : 'border-sky-400/35 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                      }`}
                    >
                      {log.action}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">{log.details || '-'}</TableCell>
                  <TableCell>
                    {new Date(log.timestamp).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        );

      default:
        return null;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Database Search</CardTitle>
        <CardDescription>
          Search across users, vehicles, and logs using any criteria
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="search-category">Search Category</Label>
              <Select
                value={searchCategory}
                onValueChange={(value: SearchCategory) => {
                  setSearchCategory(value);
                  setHasSearched(false);
                  setSearchResults([]);
                }}
              >
                <SelectTrigger id="search-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="users">Users</SelectItem>
                  <SelectItem value="vehicles">Vehicles</SelectItem>
                  <SelectItem value="logs">Logs</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="search-query">Search Query</Label>
              <div className="flex gap-2">
                <Input
                  id="search-query"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Search ${searchCategory}...`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      void handleSearch();
                    }
                  }}
                />
                <Button onClick={() => void handleSearch()}>
                  <Search className="size-4 mr-2" />
                  Search
                </Button>
              </div>
            </div>
          </div>

          {hasSearched && (
            <div className="text-sm text-muted-foreground">
              Found {searchResults.length} result(s) in {searchCategory}
            </div>
          )}

          <div className="mt-4">
            {renderResultsTable()}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
