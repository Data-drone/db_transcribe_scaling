import { useEffect, useState } from 'react';

export type WorkspaceIdentity = { email: string | null; user: string | null };
export function useWorkspaceIdentity() {
  const [identity, setIdentity] = useState<WorkspaceIdentity>({ email: null, user: null });
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/whoami', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const value: unknown = await response.json();
        if (value && typeof value === 'object') {
          setIdentity({
            email: 'email' in value && typeof value.email === 'string' ? value.email : null,
            user: 'user' in value && typeof value.user === 'string' ? value.user : null,
          });
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return identity;
}
