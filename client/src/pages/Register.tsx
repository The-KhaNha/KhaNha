import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { AuthCard } from '../features/auth/AuthCard';
import { REGISTER_DRAFT_KEY, selectUser, useAuthStore } from '../features/auth/authStore';
import { homeFor } from '../features/auth/roles';
import { useAuthRedirect } from '../features/auth/useAuthRedirect';
import {
  NAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  errorOnBlur,
  errorOnChange,
  validateEmail,
  validateName,
  validatePassword,
  validatePhone,
} from '../features/auth/validation';
import { ApiError } from '../services/api';
import { useSessionDraft } from '../lib/sessionDraft';

type Field = 'name' | 'email' | 'phone' | 'password';
type FieldErrors = Partial<Record<Field, string>>;

const EMPTY_DRAFT = { name: '', email: '', phone: '' };
const FIELDS: readonly Field[] = ['name', 'email', 'phone', 'password'];
const isField = (value: string): value is Field => (FIELDS as readonly string[]).includes(value);

export function RegisterPage() {
  const user = useAuthStore(selectUser);
  const register = useAuthStore((s) => s.register);
  const redirectAfterAuth = useAuthRedirect();
  // Keeps ?next on the way between sign-in and sign-up, so a guest from checkout lands back there.
  const location = useLocation();

  // Name, email and phone survive a refresh or Back (sessionStorage, cleared on sign-in and sign-out by authStore);
  // the password never leaves memory.
  const [draft, updateDraft] = useSessionDraft(REGISTER_DRAFT_KEY, EMPTY_DRAFT);
  const [password, setPassword] = useState('');
  const values: Record<Field, string> = { ...draft, password };
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to={homeFor(user.role)} replace />;

  const validators: Record<Field, (value: string) => string | undefined> = {
    name: validateName,
    email: validateEmail,
    phone: validatePhone,
    password: validatePassword,
  };

  function update(field: Field, value: string) {
    if (field === 'password') setPassword(value);
    else updateDraft({ [field]: value });
    setErrors(errorOnChange(field, validators[field](value)));
  }

  function validateField(field: Field) {
    setErrors(errorOnBlur(field, validators[field](values[field])));
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
      // About one field (EMAIL_TAKEN, a bad phone): say it on that field, where the eye already is.
      const field = err instanceof ApiError ? err.details?.field : undefined;
      if (err instanceof ApiError && field && isField(field)) {
        setErrors((prev) => ({ ...prev, [field]: err.message }));
        document.querySelector<HTMLInputElement>(`input[name="${field}"]`)?.focus();
      } else {
        setServerError(err instanceof ApiError ? err.message : 'Something went wrong.');
      }
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Order ahead and skip the queue in seconds."
      error={serverError}
      backTo={`/login${location.search}`}
      footer={{ prompt: 'Already have an account?', to: '/login', label: 'Sign in' }}
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
