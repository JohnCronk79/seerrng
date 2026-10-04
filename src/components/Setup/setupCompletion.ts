export interface SetupCompletionOperations {
  initialize: () => Promise<boolean>;
  saveLocale: () => Promise<void>;
  isCancellation: (error: unknown) => boolean;
}

export interface SetupCompletionResult {
  initialized: boolean;
  localeSaved: boolean;
}

export const completeSetupRequests = async ({
  initialize,
  saveLocale,
  isCancellation,
}: SetupCompletionOperations): Promise<SetupCompletionResult> => {
  const initialized = await initialize();
  if (!initialized) {
    return { initialized: false, localeSaved: false };
  }

  try {
    await saveLocale();
    return { initialized: true, localeSaved: true };
  } catch (error) {
    if (isCancellation(error)) {
      throw error;
    }
    return { initialized: true, localeSaved: false };
  }
};
