import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { User } from '@shared/types';
import { appendLog } from '@/app/data/logsRepo';
import { enqueueRecord } from '@/app/data/inputStore';
import { apiRequest } from '@/app/data/apiClient';
import { readJson, removeKey, STORAGE_KEYS, writeJson, writeString } from '@/app/data/storage';
import { closeSecondaryWindows, isSecondaryDisplay } from '@/app/utils/secondaryWindows';

interface AuthContextType {
  user: User | null;
  login: (identifier: string, password: string) => Promise<User | null>;
  register: (input: { username: string; email: string; password: string }) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => readJson<User | null>(STORAGE_KEYS.authUser, null));

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEYS.logoutSignal) return;
      closeSecondaryWindows();
      if (isSecondaryDisplay()) {
        window.close();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const login = async (identifier: string, password: string): Promise<User | null> => {
    try {
      const response = await apiRequest<{ user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
      });
      const nextUser = response.user;
      setUser(nextUser);
      writeJson(STORAGE_KEYS.authUser, nextUser);
      const timestamp = new Date().toISOString();
      void appendLog({
        id: `log-${Date.now()}`,
        userId: nextUser.id,
        username: nextUser.username,
        action: 'login',
        timestamp,
      });
      void enqueueRecord({
        ts: Date.now(),
        userId: nextUser.id,
        username: nextUser.username,
        action: 'login',
      });
      return nextUser;
    } catch {
      return null;
    }
  };

  const register = async (input: {
    username: string;
    email: string;
    password: string;
  }): Promise<User> => {
    const response = await apiRequest<{ user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return response.user;
  };

  const logout = () => {
    if (user) {
      const timestamp = new Date().toISOString();
      void appendLog({
        id: `log-${Date.now()}`,
        userId: user.id,
        username: user.username,
        action: 'logout',
        timestamp,
      });
      void enqueueRecord({
        ts: Date.now(),
        userId: user.id,
        username: user.username,
        action: 'logout',
      });
    }
    closeSecondaryWindows();
    writeString(STORAGE_KEYS.logoutSignal, String(Date.now()));
    if (isSecondaryDisplay()) {
      window.close();
    }
    setUser(null);
    removeKey(STORAGE_KEYS.authUser);
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

