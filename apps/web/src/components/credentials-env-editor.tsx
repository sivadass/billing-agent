import { Button, Container, FormControls, Typography } from 'cleanplate';

export type CredentialEnvRow = {
  key: string;
  envName: string;
};

type CredentialsEnvEditorProps = {
  rows: CredentialEnvRow[];
  onChange: (rows: CredentialEnvRow[]) => void;
};

export function CredentialsEnvEditor({ rows, onChange }: CredentialsEnvEditorProps) {
  const updateRow = (index: number, patch: Partial<CredentialEnvRow>) => {
    onChange(
      rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  };

  const removeRow = (index: number) => {
    onChange(rows.filter((_, rowIndex) => rowIndex !== index));
  };

  return (
    <Container padding="0" margin="t-3">
      <Typography variant="h3" margin="b-2">
        Credentials env mapping
      </Typography>
      {rows.map((row, index) => (
        <Container key={index} display="flex" gap="2" margin="b-3" align="end">
          <FormControls.Input
            label={`Credential key ${index + 1}`}
            value={row.key}
            onChange={(event) =>
              updateRow(index, { key: event.target.value })
            }
            isFluid
          />
          <FormControls.Input
            label={`Environment name ${index + 1}`}
            value={row.envName}
            onChange={(event) =>
              updateRow(index, { envName: event.target.value })
            }
            isFluid
          />
          <Button variant="outline" onClick={() => removeRow(index)}>
            Remove
          </Button>
        </Container>
      ))}
      <Button
        variant="outline"
        onClick={() => onChange([...rows, { key: '', envName: '' }])}
      >
        Add credential
      </Button>
    </Container>
  );
}
