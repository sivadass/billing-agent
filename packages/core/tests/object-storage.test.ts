import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  __resetObjectStorageForTests,
  __setObjectStorageForTests,
  conversationScreenshotKey,
  getB2Config,
  isConversationScreenshotKey,
  isObjectStorageConfigured,
  resolveB2RegionFromEndpoint,
  signConversationScreenshots,
  uploadConversationScreenshot,
  uploadObject,
} from '../src/object-storage.ts';

const B2_ENV: NodeJS.ProcessEnv = {
  B2_ACCESS_KEY_ID: 'test-key',
  B2_SECRET_ACCESS_KEY: 'test-secret',
  B2_BUCKET_NAME: 'notepad-attachments',
  B2_ENDPOINT: 'https://s3.us-east-005.backblazeb2.com',
  B2_PRESIGNED_EXPIRES_SECONDS: '3600',
};

afterEach(() => {
  __resetObjectStorageForTests();
});

describe('B2 config', () => {
  it('derives region from the B2 endpoint hostname', () => {
    assert.equal(
      resolveB2RegionFromEndpoint('https://s3.us-east-005.backblazeb2.com'),
      'us-east-005',
    );
  });

  it('accepts notepad alias env names', () => {
    const config = getB2Config({
      B2_KEY_ID: 'alias-key',
      B2_APPLICATION_KEY: 'alias-secret',
      B2_BUCKET: 'notepad-attachments',
      B2_ENDPOINT: 'https://s3.us-east-005.backblazeb2.com',
    });
    assert.equal(config.accessKeyId, 'alias-key');
    assert.equal(config.secretAccessKey, 'alias-secret');
    assert.equal(config.bucket, 'notepad-attachments');
    assert.equal(config.endpoint, 'https://s3.us-east-005.backblazeb2.com');
  });

  it('is configured only when key, secret, bucket, and endpoint are set', () => {
    assert.equal(isObjectStorageConfigured(B2_ENV), true);
    assert.equal(isObjectStorageConfigured({}), false);
    assert.equal(
      isObjectStorageConfigured({ ...B2_ENV, B2_BUCKET_NAME: '' }),
      false,
    );
  });
});

describe('conversation screenshot keys', () => {
  it('namespaces keys under billing-agent/conversations', () => {
    const key = conversationScreenshotKey('conv-1', 1_700_000_000_000);
    assert.equal(key, 'billing-agent/conversations/conv-1/1700000000000.png');
    assert.equal(isConversationScreenshotKey(key), true);
  });

  it('rejects local filesystem paths and notepad asset keys', () => {
    assert.equal(isConversationScreenshotKey('/tmp/conv-1.png'), false);
    assert.equal(
      isConversationScreenshotKey('users/abc/asset.jpg'),
      false,
    );
  });
});

describe('uploadObject', () => {
  it('puts PNG bytes into the configured bucket', async () => {
    const sent: Array<{ name: string; input: Record<string, unknown> }> = [];
    __setObjectStorageForTests({
      client: {
        send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
          sent.push({ name: command.constructor.name, input: command.input });
          return {};
        },
      },
    });

    const body = Buffer.from('png-bytes');
    await uploadObject({
      key: 'billing-agent/conversations/conv-1/1.png',
      body,
      contentType: 'image/png',
      env: B2_ENV,
    });

    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.name, 'PutObjectCommand');
    assert.equal(sent[0]?.input.Bucket, 'notepad-attachments');
    assert.equal(sent[0]?.input.Key, 'billing-agent/conversations/conv-1/1.png');
    assert.equal(sent[0]?.input.ContentType, 'image/png');
    assert.equal(sent[0]?.input.Body, body);
  });
});

describe('uploadConversationScreenshot', () => {
  it('uploads under a conversation key and returns that key', async () => {
    let uploadedKey: string | undefined;
    __setObjectStorageForTests({
      client: {
        send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
          uploadedKey = String(command.input.Key);
          return {};
        },
      },
    });

    const key = await uploadConversationScreenshot({
      conversationId: 'conv-99',
      body: Buffer.from('png'),
      env: B2_ENV,
    });

    assert.equal(isConversationScreenshotKey(key), true);
    assert.match(key, /^billing-agent\/conversations\/conv-99\/\d+\.png$/);
    assert.equal(uploadedKey, key);
  });
});

describe('signConversationScreenshots', () => {
  it('attaches presigned URLs only for B2 conversation keys', async () => {
    __setObjectStorageForTests({
      presignGet: async ({ key }) => `https://b2.example/get?key=${encodeURIComponent(key)}`,
    });

    const signed = await signConversationScreenshots(
      [
        {
          id: 'm1',
          role: 'assistant',
          text: 'Captured a page snapshot.',
          screenshotPath: 'billing-agent/conversations/conv-1/1.png',
          createdAt: '2026-08-19T00:00:00.000Z',
        },
        {
          id: 'm2',
          role: 'assistant',
          text: 'old local file',
          screenshotPath: '/tmp/legacy.png',
          createdAt: '2026-08-19T00:00:00.000Z',
        },
        {
          id: 'm3',
          role: 'user',
          text: 'no screenshot',
          createdAt: '2026-08-19T00:00:00.000Z',
        },
      ],
      B2_ENV,
    );

    assert.equal(
      signed[0]?.screenshotUrl,
      'https://b2.example/get?key=billing-agent%2Fconversations%2Fconv-1%2F1.png',
    );
    assert.equal(signed[1]?.screenshotUrl, undefined);
    assert.equal(signed[2]?.screenshotUrl, undefined);
  });
});
