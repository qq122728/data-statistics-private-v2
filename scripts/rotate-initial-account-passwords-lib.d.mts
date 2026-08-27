export type InitialAccount = { id: string; username: string };
export type InitialPasswordEntry = [username: string, password: string];

export const INITIAL_USERNAME_MAX_LENGTH: 200;
export const INITIAL_PASSWORD_MIN_LENGTH: 12;
export const INITIAL_PASSWORD_MAX_LENGTH: 256;

export function validateInitialPasswordEntries(entries: InitialPasswordEntry[]): InitialPasswordEntry[];
export function parseInitialPasswordEntries(contents: string): InitialPasswordEntry[];

type RotationClient = {
  user: {
    update(args: {
      where: { id: string };
      data: { passwordHash: string; mustChangePassword: true };
    }): Promise<unknown>;
  };
  session: {
    deleteMany(args: { where: { userId: string } }): Promise<unknown>;
  };
};

type RotationDatabase = {
  $transaction<T>(callback: (client: RotationClient) => Promise<T>): Promise<T>;
};

export function rotateInitialAccountPasswords(
  db: RotationDatabase,
  existing: InitialAccount[],
  entries: InitialPasswordEntry[],
  hashPassword: (password: string) => string,
): Promise<void>;
