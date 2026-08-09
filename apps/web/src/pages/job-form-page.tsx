import { PageHeader, Typography } from 'cleanplate';
import { useParams } from 'react-router-dom';

export function JobFormPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const title = jobId ? `Edit job: ${jobId}` : 'Create job';

  return (
    <>
      <PageHeader title={title} subtitle="Job form will be implemented next." />
      <Typography variant="p" margin="t-3">
        Job form placeholder.
      </Typography>
    </>
  );
}
