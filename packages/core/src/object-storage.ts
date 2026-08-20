import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ConversationMessage } from './store/types.js';

const CONVERSATION_SCREENSHOT_PREFIX = 'billing-agent/conversations/';
const RUN_SCREENSHOT_PREFIX = 'billing-agent/runs/';
const CONVERSATION_SCREENSHOT_KEY_PATTERN =
  /^billing-agent\/conversations\/[A-Za-z0-9._-]+\/\d+\.png$/;
const RUN_SCREENSHOT_KEY_PATTERN =
  /^billing-agent\/runs\/[A-Za-z0-9._-]+\/\d+\.png$/;

export type B2Config = {
  accessKeyId: string | undefined;
  secretAccessKey: string | undefined;
  bucket: string | undefined;
  endpoint: string | undefined;
  expiresIn: number;
};

type S3ClientLike = {
  send(command: unknown): Promise<unknown>;
};

type ObjectStorageOverrides = {
  client?: S3ClientLike;
  presignGet?: (input: { key: string; env?: NodeJS.ProcessEnv }) => Promise<string>;
};

let overrides: ObjectStorageOverrides = {};

function readEnv(env: NodeJS.ProcessEnv, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value != null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return undefined;
}

export function resolveB2RegionFromEndpoint(endpoint: string): string {
  try {
    const hostname = new URL(endpoint).hostname;
    const match = hostname.match(/^s3\.([a-z0-9-]+)\.backblazeb2\.com$/i);
    if (match?.[1]) return match[1];
  } catch {
    // Fall through.
  }
  return 'auto';
}

export function getB2Config(env: NodeJS.ProcessEnv = process.env): B2Config {
  const expiresRaw = readEnv(env, 'B2_PRESIGNED_EXPIRES_SECONDS');
  const expiresIn = expiresRaw ? Number(expiresRaw) : 3600;
  return {
    accessKeyId: readEnv(env, 'B2_ACCESS_KEY_ID', 'B2_KEY_ID'),
    secretAccessKey: readEnv(env, 'B2_SECRET_ACCESS_KEY', 'B2_APPLICATION_KEY'),
    bucket: readEnv(env, 'B2_BUCKET_NAME', 'B2_BUCKET'),
    endpoint: readEnv(env, 'B2_ENDPOINT'),
    expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600,
  };
}

export function isObjectStorageConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const config = getB2Config(env);
  return Boolean(
    config.accessKeyId &&
      config.secretAccessKey &&
      config.bucket &&
      config.endpoint,
  );
}

function createClient(env: NodeJS.ProcessEnv): S3Client {
  const { accessKeyId, secretAccessKey, endpoint } = getB2Config(env);
  return new S3Client({
    region: resolveB2RegionFromEndpoint(endpoint || ''),
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: accessKeyId ?? '',
      secretAccessKey: secretAccessKey ?? '',
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

function getClient(env: NodeJS.ProcessEnv): S3ClientLike {
  if (overrides.client) return overrides.client;
  return createClient(env);
}

export function __setObjectStorageForTests(next: ObjectStorageOverrides): void {
  overrides = next;
}

export function __resetObjectStorageForTests(): void {
  overrides = {};
}

function sanitizeId(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, '_');
}

export function conversationScreenshotKey(
  conversationId: string,
  now = Date.now(),
): string {
  return `${CONVERSATION_SCREENSHOT_PREFIX}${sanitizeId(conversationId)}/${now}.png`;
}

export function isConversationScreenshotKey(key: string): boolean {
  return CONVERSATION_SCREENSHOT_KEY_PATTERN.test(key);
}

export function runScreenshotKey(runId: string, now = Date.now()): string {
  return `${RUN_SCREENSHOT_PREFIX}${sanitizeId(runId)}/${now}.png`;
}

export function isRunScreenshotKey(key: string): boolean {
  return RUN_SCREENSHOT_KEY_PATTERN.test(key);
}

export async function uploadObject(input: {
  key: string;
  body: Buffer;
  contentType: string;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const env = input.env ?? process.env;
  const { bucket } = getB2Config(env);
  await getClient(env).send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    }),
  );
}

export async function uploadConversationScreenshot(input: {
  conversationId: string;
  body: Buffer;
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  const key = conversationScreenshotKey(input.conversationId);
  await uploadObject({
    key,
    body: input.body,
    contentType: 'image/png',
    env: input.env,
  });
  return key;
}

export async function uploadRunScreenshot(input: {
  runId: string;
  body: Buffer;
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  const key = runScreenshotKey(input.runId);
  await uploadObject({
    key,
    body: input.body,
    contentType: 'image/png',
    env: input.env,
  });
  return key;
}

export async function presignGet(input: {
  key: string;
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  if (overrides.presignGet) return overrides.presignGet(input);
  const env = input.env ?? process.env;
  const { bucket, expiresIn } = getB2Config(env);
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: input.key,
  });
  return getSignedUrl(getClient(env) as S3Client, command, { expiresIn });
}

export async function signConversationScreenshots(
  messages: ConversationMessage[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<ConversationMessage[]> {
  if (!isObjectStorageConfigured(env)) return messages;
  return Promise.all(
    messages.map(async (message) => {
      const key = message.screenshotPath;
      if (!key || !isConversationScreenshotKey(key)) return message;
      try {
        const screenshotUrl = await presignGet({ key, env });
        return { ...message, screenshotUrl };
      } catch {
        return message;
      }
    }),
  );
}

export async function signRunScreenshot(
  screenshotPath: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  if (!screenshotPath || !isObjectStorageConfigured(env)) return undefined;
  if (!isRunScreenshotKey(screenshotPath)) return undefined;
  try {
    return await presignGet({ key: screenshotPath, env });
  } catch {
    return undefined;
  }
}
