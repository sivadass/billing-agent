import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ScheduleFields } from './schedule-fields';

function StatefulSchedule({
  initial,
  onChange,
}: {
  initial: string;
  onChange?: (cron: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ScheduleFields
      value={value}
      onChange={(cron) => {
        setValue(cron);
        onChange?.(cron);
      }}
    />
  );
}

function selectOption(field: string, value: string) {
  fireEvent.click(screen.getByTestId(`${field}-trigger`));
  fireEvent.click(screen.getByTestId(`${field}-option-${value}`));
}

describe('ScheduleFields', () => {
  it('shows Daily, time, and running copy for a daily cron', () => {
    render(<ScheduleFields value="0 9 * * *" onChange={vi.fn()} />);

    expect(screen.getByTestId('schedule-frequency-trigger')).toHaveTextContent('Daily');
    expect(screen.getByLabelText(/^time$/i)).toHaveValue('09:00');
    expect(screen.getByText('Runs every day at 9:00 AM')).toBeInTheDocument();
  });

  it('emits a daily cron when the time changes', () => {
    const onChange = vi.fn();
    render(<ScheduleFields value="0 9 * * *" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/^time$/i), {
      target: { value: '14:30' },
    });

    expect(onChange).toHaveBeenCalledWith('30 14 * * *');
  });

  it('emits an empty schedule when Manual is selected', () => {
    const onChange = vi.fn();
    render(<ScheduleFields value="0 9 * * *" onChange={onChange} />);

    selectOption('schedule-frequency', 'manual');

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('lets advanced cron override the simple schedule', () => {
    const onChange = vi.fn();
    render(<StatefulSchedule initial="0 9 * * *" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /advanced cron/i }));
    fireEvent.change(screen.getByLabelText(/cron expression/i), {
      target: { value: '*/5 * * * *' },
    });

    expect(onChange).toHaveBeenCalledWith('*/5 * * * *');
    expect(screen.getByText('*/5 * * * *')).toBeInTheDocument();
  });

  it('describes a blank schedule as manual', () => {
    render(<ScheduleFields value="" onChange={vi.fn()} />);

    expect(screen.getByTestId('schedule-frequency-trigger')).toHaveTextContent('Manual');
    expect(screen.getByText('Runs only when triggered manually')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^time$/i)).not.toBeInTheDocument();
  });
});
