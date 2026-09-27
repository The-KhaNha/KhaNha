import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { AuthCard } from '../features/auth/AuthCard';
import { selectUser, useAuthStore } from '../features/auth/authStore';
import { useAuthRedirect } from '../features/auth/useAuthRedirect';
import { validateEmail } from '../features/auth/validation';
import { ApiError } from '../services/api';

export function LoginPage() {
  const user = useAuthStore(selectUser);
  const login = useAuthStore((s) => s.login);
  const redirectAfterAuth = useAuthRedirect();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to={user.role === 'STAFF' ? '/staff' : '/'} replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const nextErrors = {
      email: validateEmail(email),
      password: password ? undefined : 'Please enter your password.',
    };
    setErrors(nextErrors);
    if (nextErrors.email || nextErrors.password) return;

    setSubmitting(true);
    setServerError(null);
    try {
      const signedIn = await login(email.trim(), password);
      redirectAfterAuth(signedIn);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Something went wrong.');
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to track orders and check out faster."
      error={serverError}
      footer={
        <>
          New here?{' '}
          <Link
            to="/register"
            className="font-semibold text-brand-600 underline-offset-2 hover:text-brand-700 hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <Input
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setErrors((prev) => ({ ...prev, email: validateEmail(email) }))}
          error={errors.email}
        />
        <div className="relative">
          <Input
            label="Password"
            type={showPassword ? 'text' : 'password'}
            name="password"
            autoComplete="current-password"
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            className="[&_input]:pr-12"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-1 top-[26px] grid h-11 w-11 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            {showPassword ? (
              <EyeOff className="h-5 w-5" aria-hidden />
            ) : (
              <Eye className="h-5 w-5" aria-hidden />
            )}
          </button>
        </div>
        <Button type="submit" size="lg" fullWidth loading={submitting} className="mt-2">
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}
