import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { AuthCard } from '../features/auth/AuthCard';
import { selectUser, useAuthStore } from '../features/auth/authStore';
import { useAuthRedirect } from '../features/auth/useAuthRedirect';
import {
  NAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  validateEmail,
  validateName,
  validatePassword,
  validatePhone,
} from '../features/auth/validation';
import { ApiError } from '../services/api';

type Field = 'name' | 'email' | 'phone' | 'password';
type FieldErrors = Partial<Record<Field, string>>;

export function RegisterPage() {
  const user = useAuthStore(selectUser);
  const register = useAuthStore((s) => s.register);
  const redirectAfterAuth = useAuthRedirect();

  const [values, setValues] = useState<Record<Field, string>>({ name: '', email: '', phone: '', password: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to={user.role === 'STAFF' ? '/staff' : '/'} replace />;

  const validators: Record<Field, (value: string) => string | undefined> = {
    name: validateName,
    email: validateEmail,
    phone: validatePhone,
    password: validatePassword,
  };

  function update(field: Field, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  function validateField(field: Field) {
    setErrors((prev) => ({ ...prev, [field]: validators[field](values[field]) }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const nextErrors: FieldErrors = {
      name: validateName(values.name),
      email: validateEmail(values.email),
      phone: validatePhone(values.phone),
      password: validatePassword(values.password),
    };
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;

    setSubmitting(true);
    setServerError(null);
    try {
      const phone = values.phone.trim();
      const created = await register({
        name: values.name.trim(),
        email: values.email.trim(),
        password: values.password,
        ...(phone ? { phone } : {}),
      });
      redirectAfterAuth(created);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Something went wrong.');
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Order ahead and skip the queue in seconds."
      error={serverError}
      backTo="/login"
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-brand-600 underline-offset-2 hover:text-brand-700 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <Input
          label="Name"
          name="name"
          autoComplete="name"
          placeholder="Your name"
          maxLength={NAME_MAX_LENGTH}
          value={values.name}
          onChange={(e) => update('name', e.target.value)}
          onBlur={() => validateField('name')}
          error={errors.name}
        />
        <Input
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={values.email}
          onChange={(e) => update('email', e.target.value)}
          onBlur={() => validateField('email')}
          error={errors.email}
        />
        <Input
          label="Phone"
          hint="Optional"
          type="tel"
          name="phone"
          autoComplete="tel"
          inputMode="tel"
          placeholder="98765 43210"
          value={values.phone}
          onChange={(e) => update('phone', e.target.value)}
          onBlur={() => validateField('phone')}
          error={errors.phone}
        />
        <Input
          label="Password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters`}
          type="password"
          name="password"
          autoComplete="new-password"
          placeholder="Create a password"
          value={values.password}
          onChange={(e) => update('password', e.target.value)}
          onBlur={() => validateField('password')}
          error={errors.password}
        />
        <Button type="submit" size="lg" fullWidth loading={submitting} className="mt-2">
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}
