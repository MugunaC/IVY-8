import { RouterProvider } from 'react-router';
import { router } from '@/app/routes.tsx';
import { AuthProvider } from '@/app/context/AuthContext';
import { ThemeProvider } from '@/app/context/ThemeContext';
import { Toaster } from '@/app/components/ui/sonner';

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <RouterProvider router={router} />
        <Toaster />
      </AuthProvider>
    </ThemeProvider>
  );
}