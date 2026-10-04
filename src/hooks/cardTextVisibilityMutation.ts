import type {
  CardTextVisibility,
  UserSettingsCardTextResponse,
} from '@server/interfaces/api/userSettingsInterfaces';

type CardTextMediaType = keyof UserSettingsCardTextResponse;

export interface CardTextVisibilityMutation {
  key: string;
  revision: number;
  previous: UserSettingsCardTextResponse;
  next: UserSettingsCardTextResponse;
}

export class CardTextVisibilityMutationState {
  private key = '';
  private revision = 0;
  private value: UserSettingsCardTextResponse = {};

  public synchronize(key: string, value: UserSettingsCardTextResponse): void {
    if (key !== this.key) {
      this.key = key;
      this.revision += 1;
    }
    this.value = value;
  }

  public begin(
    mediaType: CardTextMediaType,
    nextVisibility: CardTextVisibility
  ): CardTextVisibilityMutation {
    const previous = this.value;
    const next = { ...previous, [mediaType]: nextVisibility };
    const mutation = {
      key: this.key,
      revision: ++this.revision,
      previous,
      next,
    };
    this.value = next;
    return mutation;
  }

  public isCurrent(mutation: CardTextVisibilityMutation): boolean {
    return mutation.key === this.key && mutation.revision === this.revision;
  }

  public rollback(
    mutation: CardTextVisibilityMutation
  ): UserSettingsCardTextResponse | undefined {
    if (!this.isCurrent(mutation)) {
      return undefined;
    }

    this.value = mutation.previous;
    return this.value;
  }
}
