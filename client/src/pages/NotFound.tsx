import { Compass } from 'lucide-react';
import { ButtonLink } from '../components/Button';
import { EmptyState } from '../components/EmptyState';

export function NotFoundPage() {
  return (
    <EmptyState
      icon={Compass}
      tone="neutral"
      title="Page not found"
      description="The page you're looking for doesn't exist or has moved."
      action={
        <ButtonLink to="/" size="lg">
          Go Home
        </ButtonLink>
      }
    />
  );
}
