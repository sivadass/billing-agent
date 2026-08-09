import { useState } from 'react';
import { Button, Container, FormControls, Typography } from 'cleanplate';
import {
  clearApiTokenOverride,
  getApiToken,
  setApiTokenOverride,
} from '../lib/auth-token';
import styles from './token-gate.module.scss';

export type TokenGateProps = {
  onTokenChange: () => void;
};

export function TokenGate({ onTokenChange }: TokenGateProps) {
  const [value, setValue] = useState('');
  const hasToken = Boolean(getApiToken());

  return (
    <Container className={styles['token-gate']} padding="4" margin="b-4">
      <Typography variant="h3" margin="b-2">
        API token
      </Typography>
      <Typography variant="p" margin="b-3">
        Uses VITE_API_TOKEN when set. Optionally override for this browser session.
      </Typography>
      <FormControls.Input
        label="API token"
        type="password"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        isFluid
      />
      <Container display="flex" gap="2" margin="t-3">
        <Button
          variant="solid"
          onClick={() => {
            if (!value.trim()) return;
            setApiTokenOverride(value);
            setValue('');
            onTokenChange();
          }}
        >
          Save token
        </Button>
        {hasToken ? (
          <Button
            variant="outline"
            onClick={() => {
              clearApiTokenOverride();
              onTokenChange();
            }}
          >
            Clear override
          </Button>
        ) : null}
      </Container>
    </Container>
  );
}
