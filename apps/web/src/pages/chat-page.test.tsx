import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as conversationsApi from '../lib/conversations-api';
import type { ConversationDocument, ConversationSummary } from '../lib/types';
import { ChatComposer, ChatListPage, ChatPage } from './chat-page';

vi.mock('../lib/conversations-api', () => ({
  createConversation: vi.fn(),
  getConversation: vi.fn(),
  listConversations: vi.fn(),
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

const flushAsync = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

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
    expect(screen.getByText('In progress')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2200);
      await Promise.resolve();
    });
    await flushAsync();
    expect(conversationsApi.getConversation).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Saved')).toBeInTheDocument();

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
      <MemoryRouter initialEntries={['/chat/new']}>
        <Routes>
          <Route path="/chat/new" element={<ChatComposer />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByDisplayValue('https://sivadass.in/')).toBeInTheDocument();
    expect(screen.getAllByDisplayValue('Grab the contact email address').length).toBeGreaterThan(0);
  });
});

describe('Chat list', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lists conversations and navigates to a session on row click', async () => {
    vi.mocked(conversationsApi.listConversations).mockResolvedValue([
      summary(),
      summary({
        id: 'conv-2',
        status: 'saved',
        goal: 'Draft TNEB job',
        startUrl: 'https://www.tnebnet.org/awp/login',
      }),
    ]);

    render(
      <MemoryRouter initialEntries={['/chat']}>
        <Routes>
          <Route path="/chat" element={<ChatListPage />} />
          <Route path="/chat/:conversationId" element={<div>Session conv-1</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Grab the contact email address')).toBeInTheDocument();
    expect(screen.getByText('Draft TNEB job')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Grab the contact email address'));
    expect(await screen.findByText('Session conv-1')).toBeInTheDocument();
  });

  it('navigates to the composer from New chat', async () => {
    vi.mocked(conversationsApi.listConversations).mockResolvedValue([summary()]);

    render(
      <MemoryRouter initialEntries={['/chat']}>
        <Routes>
          <Route path="/chat" element={<ChatListPage />} />
          <Route path="/chat/new" element={<div>Composer route</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /new chat/i }));
    expect(await screen.findByText('Composer route')).toBeInTheDocument();
  });

  it('shows an empty state when there are no chats', async () => {
    vi.mocked(conversationsApi.listConversations).mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={['/chat']}>
        <Routes>
          <Route path="/chat" element={<ChatListPage />} />
          <Route path="/chat/new" element={<div>Composer route</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('No chats yet')).toBeInTheDocument();
    const newChatButtons = screen.getAllByRole('button', { name: /new chat/i });
    fireEvent.click(newChatButtons[0]!);
    expect(await screen.findByText('Composer route')).toBeInTheDocument();
  });
});

describe('Chat session layout', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders bubbles without role labels and a send field', async () => {
    vi.mocked(conversationsApi.getConversation).mockResolvedValue(conversation());

    render(
      <MemoryRouter initialEntries={['/chat/conv-1']}>
        <Routes>
          <Route path="/chat/:conversationId" element={<ChatPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Working on it…')).toBeInTheDocument();
    expect(screen.queryByText('assistant')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('renders a screenshot thumbnail lightbox when the message has a signed URL', async () => {
    vi.mocked(conversationsApi.getConversation).mockResolvedValue(
      conversation({
        messages: [
          {
            id: 'm-snap',
            role: 'assistant',
            text: 'Captured a page snapshot.',
            screenshotPath: 'billing-agent/conversations/conv-1/1.png',
            screenshotUrl: 'https://b2.example/signed.png',
            createdAt: '2026-08-17T12:00:00.000Z',
          },
        ],
      }),
    );

    render(
      <MemoryRouter initialEntries={['/chat/conv-1']}>
        <Routes>
          <Route path="/chat/:conversationId" element={<ChatPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const button = await screen.findByRole('button', { name: /view page snapshot full size/i });
    const thumbnail = button.querySelector('img');
    expect(thumbnail).toHaveAttribute('src', 'https://b2.example/signed.png');
    expect(thumbnail).toHaveAttribute('alt', '');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a working state while waiting for the first assistant reply', async () => {
    vi.mocked(conversationsApi.getConversation).mockResolvedValue(
      conversation({ messages: [] }),
    );

    render(
      <MemoryRouter initialEntries={['/chat/conv-1']}>
        <Routes>
          <Route path="/chat/:conversationId" element={<ChatPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Working…')).toBeInTheDocument();
    expect(screen.getByText('Agent is working…')).toBeInTheDocument();
  });
});
