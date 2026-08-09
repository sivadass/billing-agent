import { PageHeader, Typography } from 'cleanplate';
import { TokenGate } from '../components/token-gate';

export type SettingsPageProps = {
  onTokenChange: () => void;
};

export function SettingsPage({ onTokenChange }: SettingsPageProps) {
  return (
    <>
      <PageHeader title="Settings" subtitle="Session and API access" />
      <Typography variant="p" margin="b-3">
        Manage the Bearer token used for API calls from this browser.
      </Typography>
      <TokenGate onTokenChange={onTokenChange} />
    </>
  );
}
