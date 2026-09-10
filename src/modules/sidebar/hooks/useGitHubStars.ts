import { useState, useCallback } from 'react';

const DISMISS_KEY = 'CLOUDCLI_HIDE_GITHUB_STAR';

export const useGitHubStars = (owner: string, repo: string) => {
  void owner;
  void repo;
  const [isDismissed, setIsDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const dismiss = useCallback(() => {
    setIsDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, 'true');
    } catch {
      // ignore
    }
  }, []);

  // GitHub metadata is intentionally unavailable in the local runtime.
  return { starCount: null, formattedCount: null, isDismissed, dismiss };
};
