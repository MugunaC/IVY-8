import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/app/context/AuthContext';
import { useTheme } from '@/app/context/ThemeContext';
import { Button } from '@/app/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import { UsersTab } from '@/app/components/admin/UsersTab';
import { VehiclesTab } from '@/app/components/admin/VehiclesTab';
import { SearchTab } from '@/app/components/admin/SearchTab';
import { LogsTab } from '@/app/components/admin/LogsTab';
import { TelemetryTab } from '@/app/components/admin/TelemetryTab';
import { LogOut, Users, Car, Search, FileText, Activity, Moon, Sun } from 'lucide-react';

export function AdminDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('users');
  const { theme, toggleTheme } = useTheme();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <div className="app-shell min-h-screen">
      <header className="app-header-shell">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">IVY Admin Dashboard</h1>
            <p className="text-sm text-[color:var(--app-header-muted)]">Welcome, {user?.username}</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={toggleTheme} variant="outline" size="icon" className="app-header-action">
              {theme === 'light' ? <Moon className="size-4" /> : <Sun className="size-4" />}
            </Button>
            <Button onClick={handleLogout} variant="outline" className="app-header-action">
              <LogOut className="size-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid w-full max-w-3xl grid-cols-5 rounded-2xl border border-border/70 bg-card/80 p-1 shadow-sm">
            <TabsTrigger value="users" className="flex items-center gap-2">
              <Users className="size-4" />
              Users
            </TabsTrigger>
            <TabsTrigger value="vehicles" className="flex items-center gap-2">
              <Car className="size-4" />
              Vehicles
            </TabsTrigger>
            <TabsTrigger value="search" className="flex items-center gap-2">
              <Search className="size-4" />
              Search
            </TabsTrigger>
            <TabsTrigger value="logs" className="flex items-center gap-2">
              <FileText className="size-4" />
              Logs
            </TabsTrigger>
            <TabsTrigger value="input" className="flex items-center gap-2">
              <Activity className="size-4" />
              Input
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-4">
            <UsersTab />
          </TabsContent>

          <TabsContent value="vehicles" className="space-y-4">
            <VehiclesTab />
          </TabsContent>

          <TabsContent value="search" className="space-y-4">
            <SearchTab />
          </TabsContent>

          <TabsContent value="logs" className="space-y-4">
            <LogsTab />
          </TabsContent>

          <TabsContent value="input" className="space-y-4">
            <TelemetryTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
