import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationSummary } from '../lib/types';
import { ConversationsTable } from './conversations-table';

type TableMobileColumns = {
  title?: string;
  mediaAvatar?: string;
};

let lastMobileColumns: TableMobileColumns | undefined;

vi.mock('cleanplate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('cleanplate')>();
  return {
    ...actual,
    Table: (props: { mobileColumns?: TableMobileColumns }) => {
      lastMobileColumns = props.mobileColumns;
      return <div data-testid="table-stub" />;
    },
  };
});

function summary(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  const now = '2026-08-17T12:00:00.000Z';
  return {
    id: 'conv-1',
    status: 'active',
    goal: 'Grab the contact email address',
    startUrl: 'https://sivadass.in/',
    jobId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('ConversationsTable', () => {
  it('passes the title field as mediaAvatar for mobile initials', () => {
    render(<ConversationsTable conversations={[summary()]} onSelect={() => undefined} />);

    expect(lastMobileColumns?.title).toBe('goal');
    expect(lastMobileColumns?.mediaAvatar).toBe('goal');
  });
});
