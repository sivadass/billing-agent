import { Container, Typography } from 'cleanplate';
import styles from './app.module.scss';

export function App() {
  return (
    <Container className={styles['app-root']} padding="4">
      <Typography variant="h1" margin="b-2">
        Billing Agent
      </Typography>
      <Typography variant="p">Web shell scaffold</Typography>
    </Container>
  );
}
