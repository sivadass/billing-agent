import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as conversationsApi from '../lib/conversations-api';
import type { ConversationDocument } from '../lib/types';
import { ChatPage } from './chat-page';

vi.mock('../lib/conversations-api', () => ({
  createConversation: vi.fn(),
  getConversation: vi.fn(),
  postConversationMessage: vi.fn(),
  postConversationSecrets: vi.fn(),
  confirmConversation: vi.fn(),
  rejectConversationDraft: vi.fn(),
  abandonConversation: vi.fn(),
  isPollingConversationStatus: vi.fn((status: ConversationDocument['status']) =>
    status === 'active' || status === 'awaiting_secret' || status === 'confirming',
  ),
  parseSecretKeysFromMessages: vi.fn(() => []),
}));

function conversation(overrides: Partial<ConversationDocument> = {}): ConversationDocument {
  const now = '2026-08-17T12:00:00.000Z';
  return {
    id: 'conv-1',
    userId: 'user-1',
    status: 'active',
    jobId: null,
    startUrl: 'https://sivadass.in/',
    goal: 'Grab the contact email address',
    messages: [{ id: 'm1', role: 'assistant', text: 'Working on it…', createdAt: now }],
    draftWorkflow: null,
    draftSchema: null,
    draftExtract: null,
    draftNotify: null,
    draftSchedule: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const flushAsync = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('ChatPage polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(conversationsApi.getConversation)
      .mockResolvedValueOnce(conversation())
      .mockResolvedValueOnce(conversation({ status: 'saved', jobId: 'job-1' }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('stops polling once status is saved', async () => {
    render(
      <MemoryRouter initialEntries={['/chat/conv-1']}>
        <Routes>
          <Route path="/chat/:conversationId" element={<ChatPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await flushAsync();
    await flushAsync();
    expect(conversationsApi.getConversation).toHaveBeenCalledTimes(1);
    expect(screen.getByText('active')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2200);
      await Promise.resolve();
    });
    await flushAsync();
    expect(conversationsApi.getConversation).toHaveBeenCalledTimes(2);
    expect(screen.getByText('saved')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(conversationsApi.getConversation).toHaveBeenCalledTimes(2);
  });

  it('stops polling once status is expired', async () => {
    vi.mocked(conversationsApi.getConversation)
      .mockReset()
      .mockResolvedValueOnce(conversation())
      .mockResolvedValueOnce(conversation({ status: 'expired' }));

    render(
      <MemoryRouter initialEntries={['/chat/conv-1']}>
        <Routes>
          <Route path="/chat/:conversationId" element={<ChatPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await flushAsync();
    await flushAsync();
    await act(async () => {
      vi.advanceTimersByTime(2200);
      await Promise.resolve();
    });
    await flushAsync();
    expect(screen.getByText('Session expired')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(conversationsApi.getConversation).toHaveBeenCalledTimes(2);
  });
});

describe('ChatPage confirm', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('navigates to the saved job after confirm', async () => {
    vi.mocked(conversationsApi.getConversation).mockResolvedValue(
      conversation({
        status: 'confirming',
        draftExtract: { email: 'contact@sivadass.in' },
        draftSchema: [{ key: 'email', label: 'Email', type: 'string' }],
      }),
    );
    vi.mocked(conversationsApi.confirmConversation).mockResolvedValue({
      jobId: 'job-sivadass',
      conversationId: 'conv-1',
    });

    render(
      <MemoryRouter initialEntries={['/chat/conv-1']}>
        <Routes>
          <Route path="/chat/:conversationId" element={<ChatPage />} />
          <Route path="/jobs/:jobId" element={<div>Job detail route: job-sivadass</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('contact@sivadass.in')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /confirm job/i }));

    expect(await screen.findByText('Job detail route: job-sivadass')).toBeInTheDocument();
    expect(conversationsApi.confirmConversation).toHaveBeenCalledWith('conv-1');
  });
});

describe('ChatPage composer', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('prefills the canonical sivadass example', async () => {
    render(
      <MemoryRouter initialEntries={['/chat']}>
        <Routes>
          <Route path="/chat" element={<ChatPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByDisplayValue('https://sivadass.in/')).toBeInTheDocument();
    expect(screen.getAllByDisplayValue('Grab the contact email address').length).toBeGreaterThan(0);
  });
});
