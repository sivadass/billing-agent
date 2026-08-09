import { PageHeader, Typography } from 'cleanplate';
import { useParams } from 'react-router-dom';

export function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>();

  return (
    <>
      <PageHeader
        title={`Run ${runId ?? ''}`}
        subtitle="Run detail polling will be implemented next."
      />
      <Typography variant="p" margin="t-3">
        Run detail placeholder.
      </Typography>
    </>
  );
}
