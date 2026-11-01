import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { Input } from '../components/Input';
import { AuthCard } from '../features/auth/AuthCard';
import { selectUser, useAuthStore } from '../features/auth/authStore';
import { homeFor } from '../features/auth/roles';
import { useAuthRedirect } from '../features/auth/useAuthRedirect';
import { errorOnBlur, errorOnChange, validateEmail } from '../features/auth/validation';
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

  if (user) return <Navigate to={homeFor(user.role)} replace />;

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
      footer={{ prompt: 'New here?', to: '/register', label: 'Create an account' }}
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
          onChange={(e) => {
            setEmail(e.target.value);
            setErrors(errorOnChange('email', validateEmail(e.target.value)));
          }}
          onBlur={() => setErrors(errorOnBlur('email', validateEmail(email)))}
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
          <IconButton
            label={showPassword ? 'Hide password' : 'Show password'}
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-1 top-[26px]"
            icon={
              showPassword ? (
                <EyeOff className="h-5 w-5" aria-hidden />
              ) : (
                <Eye className="h-5 w-5" aria-hidden />
              )
            }
          />
        </div>
        <Button type="submit" size="lg" fullWidth loading={submitting} className="mt-2">
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}
