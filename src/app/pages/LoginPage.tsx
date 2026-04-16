import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '@/app/context/AuthContext';
import { useTheme } from '@/app/context/ThemeContext';
import { getHomeRoute } from '@/app/utils/navigation';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Alert, AlertDescription } from '@/app/components/ui/alert';
import { LogIn, Moon, Sun } from 'lucide-react';

export function LoginPage() {
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSignup, setIsSignup] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { theme, toggleTheme } = useTheme();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (isSignup) {
        if (password !== confirmPassword) {
          setError('Passwords do not match');
          return;
        }
        await register({
          username: identifier.trim(),
          email: email.trim(),
          password,
        });
        setSuccess('Account created. You can now sign in.');
        setIsSignup(false);
        setPassword('');
        setConfirmPassword('');
        return;
      }

      const user = await login(identifier, password);
      if (user) {
        const redirectParam = searchParams.get('redirect') || '';
        const canUseRedirect =
          redirectParam.startsWith('/') &&
          !redirectParam.startsWith('//') &&
          !redirectParam.startsWith('/\\') &&
          !(user.role === 'admin' && redirectParam === '/user');
        navigate(canUseRedirect ? redirectParam : getHomeRoute(user.role));
      } else {
        setError('Invalid credentials');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell relative min-h-screen overflow-hidden px-4 py-8">
      <div className="absolute right-4 top-4 z-20">
        <Button
          onClick={toggleTheme}
          variant="outline"
          size="icon"
          className="rounded-full border-border/80 bg-card/88 text-foreground shadow-sm backdrop-blur hover:bg-card"
        >
          {theme === 'light' ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </Button>
      </div>
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md items-center justify-center">
        <Card className="app-panel w-full border-white/30">
          <CardHeader className="space-y-3 p-8 pb-4">
            <div className="flex items-center justify-center">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#0f172a,#0c4a6e)] text-white shadow-lg">
                <LogIn className="size-6" />
              </div>
            </div>
            <div className="space-y-1 text-center">
              <CardTitle className="text-2xl">IVY</CardTitle>
              <CardDescription>{isSignup ? 'Create Account' : 'Log In'}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="p-8 pt-2">
            <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {success && (
              <Alert>
                <AlertDescription>{success}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="identifier">{isSignup ? 'Username' : 'Username, Email, or User ID'}</Label>
              <Input
                id="identifier"
                type="text"
                placeholder={isSignup ? 'Choose a username' : 'Enter username, email, or ID'}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
              />
            </div>

            {isSignup && (
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {isSignup && (
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Confirm password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
            )}

            <Button type="submit" className="h-11 w-full rounded-xl" disabled={loading}>
              {loading ? 'Please wait...' : isSignup ? 'Create Account' : 'Log In'}
            </Button>

            <Button
              type="button"
              variant="ghost"
              className="w-full rounded-xl"
              onClick={() => {
                setIsSignup((prev) => !prev);
                setError('');
                setSuccess('');
              }}
            >
              {isSignup ? 'Already have an account? Log in' : 'Create new account'}
            </Button>
          </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
