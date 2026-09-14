export const adapterCredentialKeys: Record<string, readonly string[]> = {
  tnpdcl: ['username', 'password'],
  dummy: [],
};

export function requiredCredentialKeys(provider: string): readonly string[] {
  return adapterCredentialKeys[provider] ?? [];
}

export function listAdapterProviders(): Array<{
  id: string;
  credentialKeys: string[];
}> {
  return Object.entries(adapterCredentialKeys).map(([id, credentialKeys]) => ({
    id,
    credentialKeys: [...credentialKeys],
  }));
}

/** Returns an error message, or null if valid. */
export function validateSecretPayload(
  provider: string,
  values: Record<string, string>,
  mode: 'create' | 'update',
): string | null {
  const allowed = new Set(requiredCredentialKeys(provider));

  if (mode === 'update' && Object.keys(values).length === 0) {
    return 'secrets values must not be empty';
  }

  for (const [key, value] of Object.entries(values)) {
    if (!allowed.has(key)) {
      return `unknown secret key: ${key}`;
    }
    if (value === '') {
      return `secret key "${key}" must not be empty`;
    }
  }

  if (mode === 'create') {
    for (const key of allowed) {
      if (values[key] === undefined) {
        return `missing secret key: ${key}`;
      }
    }
  }

  return null;
}
