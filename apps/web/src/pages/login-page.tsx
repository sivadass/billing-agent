import { Alert, Button, Container, FormControls } from 'cleanplate';
import { FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { login } from '../lib/auth-api';
import { getAccessToken } from '../lib/auth-token';
import styles from './login-page.module.scss';

type LocationState = {
  from?: { pathname?: string };
};

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (getAccessToken()) {
    return <Navigate to="/jobs" replace />;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
      const state = location.state as LocationState | null;
      const next = state?.from?.pathname;
      navigate(next && next !== '/login' ? next : '/jobs', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid email or password');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles['login-page']}>
      <Container className={styles.card} padding="5" showBorder>
        <img
          className={styles.logo}
          src="/billing-agent-logo.svg"
          alt="Billing Agent"
          width={159}
          height={32}
        />
        <form onSubmit={(event) => void onSubmit(event)}>
          <FormControls.Input
            label="Email"
            type="email"
            name="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            isFluid
            isRequired
          />
          <FormControls.Input
            label="Password"
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            isFluid
            isRequired
            margin="t-3"
          />
          {error ? <Alert variant="error" margin="t-3" message={error} /> : null}
          <Button type="submit" variant="solid" isFluid margin="t-4" isLoading={isSubmitting}>
            Sign in
          </Button>
        </form>
      </Container>
    </div>
  );
}
