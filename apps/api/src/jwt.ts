import { jwtVerify, SignJWT } from 'jose';

export type AccessTokenClaims = {
  userId: string;
  email: string;
};

export type SignAccessTokenInput = AccessTokenClaims & {
  secret: string;
  expiresIn?: string;
};

export async function signAccessToken(input: SignAccessTokenInput): Promise<string> {
  const { userId, email, secret, expiresIn = '7d' } = input;
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(secret));
}

export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    const userId = payload.sub;
    const email = payload.email;
    if (typeof userId !== 'string' || typeof email !== 'string') {
      return null;
    }
    return { userId, email };
  } catch {
    return null;
  }
}
