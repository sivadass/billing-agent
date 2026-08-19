import {
  Alert,
  Badge,
  Button,
  Container,
  FeedbackState,
  FormControls,
  Icon,
  PageHeader,
  Typography,
} from 'cleanplate';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ConversationsTable } from '../components/conversations-table';
import { Loader } from '../components/loader';
import {
  abandonConversation,
  confirmConversation,
  createConversation,
  getConversation,
  isPollingConversationStatus,
  listConversations,
  parseSecretKeysFromMessages,
  postConversationMessage,
  postConversationSecrets,
  rejectConversationDraft,
} from '../lib/conversations-api';
import { conversationStatusVariant } from '../lib/conversation-status';
import {
  formatClockTime,
  formatDateHeading,
  isSameLocalDay,
} from '../lib/timestamp-humanize';
import type { ConversationDocument, ConversationSummary, NotifyChannel } from '../lib/types';
import styles from './chat-page.module.scss';

const DEFAULT_START_URL = 'https://sivadass.in/';
const DEFAULT_GOAL = 'Grab the contact email address';

const CHANNEL_OPTIONS: Array<{ label: string; value: NotifyChannel['type'] }> = [
  { label: 'ntfy', value: 'ntfy' },
  { label: 'Webhook', value: 'webhook' },
];

export function ChatComposer() {
  const navigate = useNavigate();
  const [startUrl, setStartUrl] = useState(DEFAULT_START_URL);
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [schedule, setSchedule] = useState('');
  const [notifyTitle, setNotifyTitle] = useState(DEFAULT_GOAL);
  const [channelType, setChannelType] = useState<NotifyChannel['type']>('ntfy');
  const [ntfyTopic, setNtfyTopic] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const channelValue = useMemo(
    () => CHANNEL_OPTIONS.find((option) => option.value === channelType) ?? null,
    [channelType],
  );

  const handleSubmit = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const notify =
        ntfyTopic.trim() || webhookUrl.trim() || notifyTitle.trim()
          ? {
              title: notifyTitle.trim() || goal.trim(),
              on: 'always' as const,
              channel:
                channelType === 'webhook'
                  ? { type: 'webhook' as const, url: webhookUrl.trim() }
                  : { type: 'ntfy' as const, topic: ntfyTopic.trim() },
            }
          : undefined;

      const conversation = await createConversation({
        startUrl: startUrl.trim(),
        goal: goal.trim(),
        schedule: schedule.trim() ? schedule.trim() : null,
        notify,
      });
      navigate(`/chat/${conversation.id}`, { replace: true });
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : 'Failed to start chat',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="New chat"
        subtitle="Describe a site and goal; the agent proposes a replayable workflow job."
      />
      {error ? <Alert variant="error" margin="t-3" message={error} /> : null}
      <Container padding="0" margin="t-4" className={styles.composer}>
        <FormControls.Input
          label="Start URL"
          value={startUrl}
          onChange={(event) => setStartUrl(event.target.value)}
          isFluid
        />
        <FormControls.Input
          label="Goal"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          isFluid
          margin="t-3"
        />
        <FormControls.Input
          label="Schedule (cron, optional)"
          value={schedule}
          onChange={(event) => setSchedule(event.target.value)}
          isFluid
          margin="t-3"
        />
        <FormControls.Input
          label="Notify title (optional)"
          value={notifyTitle}
          onChange={(event) => setNotifyTitle(event.target.value)}
          isFluid
          margin="t-3"
        />
        <FormControls.Select
          label="Notify channel (optional)"
          options={CHANNEL_OPTIONS}
          value={channelValue}
          onChange={(selected) => {
            if (selected && !Array.isArray(selected)) {
              setChannelType(selected.value as NotifyChannel['type']);
            }
          }}
          margin="t-3"
        />
        {channelType === 'ntfy' ? (
          <FormControls.Input
            label="ntfy topic"
            value={ntfyTopic}
            onChange={(event) => setNtfyTopic(event.target.value)}
            isFluid
            margin="t-3"
          />
        ) : (
          <FormControls.Input
            label="Webhook URL"
            value={webhookUrl}
            onChange={(event) => setWebhookUrl(event.target.value)}
            isFluid
            margin="t-3"
          />
        )}
        <Container display="flex" gap="2" padding="0" margin="t-4">
          <Button variant="solid" onClick={() => void handleSubmit()} disabled={isSubmitting}>
            {isSubmitting ? 'Starting…' : 'Start chat'}
          </Button>
        </Container>
      </Container>
    </>
  );
}

function ChatThread({ conversationId }: { conversationId: string }) {
  const navigate = useNavigate();
  const [conversation, setConversation] = useState<ConversationDocument | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messageText, setMessageText] = useState('');
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  const [isBusy, setIsBusy] = useState(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const loadConversation = useCallback(async () => {
    setError(null);
    try {
      const result = await getConversation(conversationId);
      setConversation(result);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'Failed to load conversation',
      );
    } finally {
      setIsLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    setIsLoading(true);
    void loadConversation();
  }, [loadConversation]);

  useEffect(() => {
    if (!conversation || !isPollingConversationStatus(conversation.status)) return;
    const timer = setInterval(() => {
      void loadConversation();
    }, 2000);
    return () => clearInterval(timer);
  }, [conversation?.status, loadConversation]);

  const secretKeys = useMemo(
    () => (conversation ? parseSecretKeysFromMessages(conversation.messages) : []),
    [conversation],
  );

  useEffect(() => {
    if (secretKeys.length === 0) return;
    setSecretValues((current) => {
      const next = { ...current };
      for (const key of secretKeys) {
        if (!(key in next)) next[key] = '';
      }
      return next;
    });
  }, [secretKeys]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: 'end' });
  }, [conversation?.messages.length, isBusy]);

  const handleSendMessage = async () => {
    if (!messageText.trim()) return;
    setIsBusy(true);
    setError(null);
    try {
      const updated = await postConversationMessage(conversationId, messageText.trim());
      setConversation(updated);
      setMessageText('');
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Failed to send message');
    } finally {
      setIsBusy(false);
    }
  };

  const handleSubmitSecrets = async () => {
    setIsBusy(true);
    setError(null);
    try {
      const updated = await postConversationSecrets(conversationId, secretValues);
      setConversation(updated);
      setSecretValues({});
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to save secrets');
    } finally {
      setIsBusy(false);
    }
  };

  const handleConfirm = async () => {
    setIsBusy(true);
    setError(null);
    try {
      const result = await confirmConversation(conversationId);
      navigate(`/jobs/${result.jobId}`, { replace: true });
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : 'Failed to confirm job');
      setIsBusy(false);
    }
  };

  const handleKeepGoing = async () => {
    setIsBusy(true);
    setError(null);
    try {
      const updated = await rejectConversationDraft(conversationId);
      setConversation(updated);
    } catch (rejectError) {
      setError(rejectError instanceof Error ? rejectError.message : 'Failed to continue chat');
    } finally {
      setIsBusy(false);
    }
  };

  const handleAbandon = async () => {
    setIsBusy(true);
    setError(null);
    try {
      await abandonConversation(conversationId);
      navigate('/chat', { replace: true });
    } catch (abandonError) {
      setError(abandonError instanceof Error ? abandonError.message : 'Failed to abandon chat');
      setIsBusy(false);
    }
  };

  if (isLoading && !conversation) {
    return (
      <div className={styles['loading-state']}>
        <Loader size={56} />
      </div>
    );
  }

  if (!conversation) {
    return (
      <FeedbackState
        variant="empty"
        margin="t-5"
        title="Conversation not found"
        primaryAction={{ label: 'New chat', onClick: () => navigate('/chat') }}
      />
    );
  }

  const draftEntries = conversation.draftExtract
    ? Object.entries(conversation.draftExtract)
    : [];
  const lastMessage = conversation.messages[conversation.messages.length - 1];
  const isAwaitingReply =
    isBusy ||
    (isPollingConversationStatus(conversation.status) &&
      (conversation.messages.length === 0 || lastMessage?.role === 'user'));

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSendMessage();
    }
  };

  return (
    <div className={styles.session}>
      <div className={styles['session-header']}>
        <PageHeader
          title="Chat session"
          subtitle={conversation.goal ?? conversation.startUrl ?? conversationId}
          primaryCta={
            <Button variant="outline" onClick={() => void handleAbandon()} disabled={isBusy}>
              Abandon
            </Button>
          }
        />
        {error ? <Alert variant="error" margin="t-3" message={error} /> : null}

        <Container className={styles.meta} padding="0" margin="t-3">
          <Badge label={conversation.status} variant={conversationStatusVariant(conversation.status)} />
          {isPollingConversationStatus(conversation.status) ? (
            <Typography variant="small" className={styles['polling-hint']}>
              {isAwaitingReply ? 'Agent is working…' : 'Live · updates every 2s'}
            </Typography>
          ) : null}
        </Container>
      </div>

      <div className={styles['session-body']}>
        <div className={styles.thread}>
          {conversation.messages.map((message, index) => {
            const previous = conversation.messages[index - 1];
            const showDay =
              !previous || !isSameLocalDay(previous.createdAt, message.createdAt);
            const isUser = message.role === 'user';
            return (
              <Fragment key={message.id}>
                {showDay ? (
                  <div className={styles['day-separator']}>
                    <Typography variant="small" className={styles['day-label']}>
                      {formatDateHeading(message.createdAt)}
                    </Typography>
                  </div>
                ) : null}
                <div
                  className={`${styles.message} ${
                    isUser ? styles['message-user'] : styles['message-assistant']
                  }`}
                >
                  <div className={styles.bubble}>
                    <Typography variant="p" className={styles['bubble-text']}>
                      {message.text}
                    </Typography>
                    {message.screenshotPath ? (
                      <Typography
                        variant="small"
                        className={styles['message-meta']}
                        margin="t-2"
                        title={message.screenshotPath}
                      >
                        Screenshot attached
                      </Typography>
                    ) : null}
                  </div>
                  <Typography variant="small" className={styles['message-meta']}>
                    {formatClockTime(message.createdAt)}
                  </Typography>
                </div>
              </Fragment>
            );
          })}
          {isAwaitingReply ? (
            <div
              className={`${styles.message} ${styles['message-assistant']}`}
              aria-live="polite"
            >
              <div className={`${styles.bubble} ${styles.waiting}`}>
                <Loader size={20} aria-label="Agent is working" />
                <Typography variant="p" className={styles['bubble-text']} margin="0">
                  Working…
                </Typography>
              </div>
            </div>
          ) : null}
          <div ref={threadEndRef} />
        </div>

        {conversation.status === 'awaiting_secret' ? (
          <Container className={styles.panel} padding="4" showBorder>
            <Typography variant="h4" margin="b-3">
              Secrets required
            </Typography>
            {secretKeys.map((key) => (
              <FormControls.Input
                key={key}
                label={key}
                type={/password|secret|token/i.test(key) ? 'password' : 'text'}
                value={secretValues[key] ?? ''}
                onChange={(event) =>
                  setSecretValues((current) => ({ ...current, [key]: event.target.value }))
                }
                isFluid
                margin={key === secretKeys[0] ? '0' : 't-3'}
              />
            ))}
            <Container display="flex" gap="2" padding="0" margin="t-4">
              <Button variant="solid" onClick={() => void handleSubmitSecrets()} disabled={isBusy}>
                Submit secrets
              </Button>
            </Container>
          </Container>
        ) : null}

        {conversation.status === 'confirming' ? (
          <Container className={styles.panel} padding="4" showBorder>
            <Typography variant="h4" margin="b-3">
              Confirm proposed job
            </Typography>
            {draftEntries.length > 0 ? (
              <div className={styles['sample-grid']}>
                {draftEntries.map(([key, value]) => (
                  <div key={key} className={styles['sample-row']}>
                    <Typography variant="small">{key}</Typography>
                    <Typography variant="p" margin="0">
                      {String(value)}
                    </Typography>
                  </div>
                ))}
              </div>
            ) : (
              <Typography variant="p" className={styles['message-meta']}>
                No sample extract yet.
              </Typography>
            )}
            <Container display="flex" gap="2" padding="0" margin="t-4">
              <Button variant="solid" onClick={() => void handleConfirm()} disabled={isBusy}>
                Confirm job
              </Button>
              <Button variant="outline" onClick={() => void handleKeepGoing()} disabled={isBusy}>
                Keep going
              </Button>
            </Container>
          </Container>
        ) : null}

        {conversation.status === 'saved' && conversation.jobId ? (
          <Container className={styles.panel} padding="4" showBorder>
            <Typography variant="p" margin="b-3">
              Job saved. You can run it from the Jobs hub.
            </Typography>
            <Button variant="solid" onClick={() => navigate(`/jobs/${conversation.jobId}`)}>
              Open job
            </Button>
          </Container>
        ) : null}

        {conversation.status === 'expired' || conversation.status === 'abandoned' ? (
          <FeedbackState
            variant="empty"
            title={conversation.status === 'expired' ? 'Session expired' : 'Session abandoned'}
            description="Start a new chat to author another job."
            primaryAction={{ label: 'New chat', onClick: () => navigate('/chat') }}
          />
        ) : null}
      </div>

      {conversation.status === 'active' ? (
        <form
          className={styles['composer-dock']}
          onSubmit={(event) => {
            event.preventDefault();
            void handleSendMessage();
          }}
        >
          <div className={styles['composer-pill']}>
            <textarea
              className={styles['composer-input']}
              value={messageText}
              onChange={(event) => setMessageText(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Message"
              aria-label="Message"
              disabled={isBusy}
              rows={1}
            />
            <Button
              className={styles['composer-send']}
              variant="icon"
              type="submit"
              aria-label="Send"
              isLoading={isBusy}
              isDisabled={isBusy || !messageText.trim()}
            >
              <Icon name="arrow_upward" color="white" size="small" />
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export function ChatListPage() {
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void listConversations()
      .then((items) => {
        if (!cancelled) setConversations(items);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load chats');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <PageHeader
        title="Chat"
        subtitle="Reopen a session to continue or abandon it."
        primaryCta={
          <Button variant="solid" onClick={() => navigate('/chat/new')}>
            New chat
          </Button>
        }
      />
      {error ? <Alert variant="error" margin="t-3" message={error} /> : null}
      {isLoading ? (
        <div className={styles['loading-state']}>
          <Loader size={56} />
        </div>
      ) : null}
      {!isLoading && !error && conversations.length === 0 ? (
        <FeedbackState
          variant="empty"
          margin="t-5"
          title="No chats yet"
          primaryAction={{ label: 'New chat', onClick: () => navigate('/chat/new') }}
        />
      ) : null}
      {!isLoading && !error && conversations.length > 0 ? (
        <ConversationsTable
          conversations={conversations}
          onSelect={(conversation) => navigate(`/chat/${conversation.id}`)}
        />
      ) : null}
    </>
  );
}

export function ChatPage() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  if (!conversationId) return <ChatListPage />;
  return <ChatThread conversationId={conversationId} />;
}
