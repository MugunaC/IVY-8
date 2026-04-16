import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/app/context/AuthContext';
import { useTheme } from '@/app/context/ThemeContext';
import { Button } from '@/app/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import { AppShellHeader } from '@/app/components/layout/AppShellHeader';
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
      <AppShellHeader
        title="IVY Admin Dashboard"
        subtitle={`Welcome, ${user?.username ?? ''}`}
        actions={
          <>
            <Button onClick={toggleTheme} variant="outline" size="icon" className="app-header-action">
              {theme === 'light' ? <Moon className="size-4" /> : <Sun className="size-4" />}
            </Button>
            <Button
              onClick={handleLogout}
              variant="outline"
              size="icon"
              className="app-header-action"
              aria-label="Log out"
              title="Log out"
            >
              <LogOut className="size-4" />
            </Button>
          </>
        }
      />

      <main className="container mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid h-auto w-full grid-cols-5 rounded-2xl border border-border/70 bg-card/80 p-1 shadow-sm">
            <TabsTrigger value="users" className="flex min-w-0 flex-col gap-1 px-2 py-2 text-[11px] sm:flex-row sm:gap-2 sm:px-3 sm:py-1.5 sm:text-sm">
              <Users className="size-4" />
              Users
            </TabsTrigger>
            <TabsTrigger value="vehicles" className="flex min-w-0 flex-col gap-1 px-2 py-2 text-[11px] sm:flex-row sm:gap-2 sm:px-3 sm:py-1.5 sm:text-sm">
              <Car className="size-4" />
              Vehicles
            </TabsTrigger>
            <TabsTrigger value="search" className="flex min-w-0 flex-col gap-1 px-2 py-2 text-[11px] sm:flex-row sm:gap-2 sm:px-3 sm:py-1.5 sm:text-sm">
              <Search className="size-4" />
              Search
            </TabsTrigger>
            <TabsTrigger value="logs" className="flex min-w-0 flex-col gap-1 px-2 py-2 text-[11px] sm:flex-row sm:gap-2 sm:px-3 sm:py-1.5 sm:text-sm">
              <FileText className="size-4" />
              Logs
            </TabsTrigger>
            <TabsTrigger value="input" className="flex min-w-0 flex-col gap-1 px-2 py-2 text-[11px] sm:flex-row sm:gap-2 sm:px-3 sm:py-1.5 sm:text-sm">
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
