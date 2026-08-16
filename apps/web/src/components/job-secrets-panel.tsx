import { Badge, Button, Container, FormControls, Typography } from 'cleanplate';
import type { JobSecretKey } from '../lib/types';

export type NewSecretRow = {
  key: string;
  value: string;
};

type JobSecretsPanelProps = {
  keys: JobSecretKey[];
  /** New value per already-stored key; empty means "leave the stored one alone". */
  replacements: Record<string, string>;
  onReplacementChange: (key: string, value: string) => void;
  newRows: NewSecretRow[];
  onNewRowsChange: (rows: NewSecretRow[]) => void;
  error?: string | null;
};

export function JobSecretsPanel({
  keys,
  replacements,
  onReplacementChange,
  newRows,
  onNewRowsChange,
  error,
}: JobSecretsPanelProps) {
  const updateRow = (index: number, patch: Partial<NewSecretRow>) => {
    onNewRowsChange(
      newRows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  };

  return (
    <Container padding="0" margin="t-4">
      <Typography variant="h3" margin="b-1">
        Secrets
      </Typography>
      <Typography variant="small" margin="b-3">
        Stored encrypted. Values are never shown again — type a new one to replace it.
      </Typography>
      {error ? (
        <Typography variant="small" margin="b-3">
          {error}
        </Typography>
      ) : null}
      {keys.length === 0 ? (
        <Typography variant="p" margin="b-3">
          No secrets stored for this job.
        </Typography>
      ) : null}
      {keys.map((secret) => (
        <Container key={secret.key} padding="0" margin="b-3">
          <Container display="flex" align="center" gap="2" padding="0" margin="b-2">
            <Typography variant="p" margin="0">
              {secret.key}
            </Typography>
            <Badge label="set" variant="success" />
          </Container>
          <FormControls.Input
            label={`New value for ${secret.key}`}
            type="password"
            autoComplete="new-password"
            value={replacements[secret.key] ?? ''}
            onChange={(event) => onReplacementChange(secret.key, event.target.value)}
            placeholder="Leave blank to keep the stored value"
            isFluid
          />
        </Container>
      ))}
      {newRows.map((row, index) => (
        <Container key={index} display="flex" gap="2" margin="b-3" align="end">
          <FormControls.Input
            label={`Secret key ${index + 1}`}
            value={row.key}
            onChange={(event) => updateRow(index, { key: event.target.value })}
            isFluid
          />
          <FormControls.Input
            label={`Secret value ${index + 1}`}
            type="password"
            autoComplete="new-password"
            value={row.value}
            onChange={(event) => updateRow(index, { value: event.target.value })}
            isFluid
          />
          <Button
            variant="outline"
            onClick={() =>
              onNewRowsChange(newRows.filter((_, rowIndex) => rowIndex !== index))
            }
          >
            Remove
          </Button>
        </Container>
      ))}
      <Button
        variant="outline"
        onClick={() => onNewRowsChange([...newRows, { key: '', value: '' }])}
      >
        Add secret
      </Button>
    </Container>
  );
}
