import { APP_VERSION } from '@/shared/constants';
import type { InstallMode, ReleaseInfo } from '@/shared/types';

type VersionCheckResult = {
  updateAvailable: boolean;
  latestVersion: string | null;
  currentVersion: string;
  releaseInfo: ReleaseInfo | null;
  installMode: InstallMode;
  runningVersion: string;
  restartRequired: boolean;
};

export const useVersionCheck = (owner: string, repo: string): VersionCheckResult => {
  void owner;
  void repo;
  const installMode: InstallMode = 'git';
  const releaseInfo: ReleaseInfo | null = null;

  return {
    updateAvailable: false,
    latestVersion: null,
    currentVersion: APP_VERSION,
    releaseInfo,
    installMode,
    runningVersion: APP_VERSION,
    restartRequired: false,
  };
};
