import { useState } from 'react';
import { Container, Typography } from 'cleanplate';
import { StatusPage } from './components/status-page';
import { TokenGate } from './components/token-gate';
import styles from './app.module.scss';

export function App() {
  const [tokenEpoch, setTokenEpoch] = useState(0);

  return (
    <Container className={styles['app-root']} padding="4">
      <Typography variant="h1" margin="b-3">
        Billing Agent
      </Typography>
      <TokenGate onTokenChange={() => setTokenEpoch((value) => value + 1)} />
      <StatusPage key={tokenEpoch} />
    </Container>
  );
}
