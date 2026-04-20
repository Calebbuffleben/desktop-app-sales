import path from "node:path";
import fs from "node:fs";
import { safeStorage, app } from "electron";

export type MembershipRoleValue = "OWNER" | "ADMIN" | "MEMBER";

export interface PersistedAuthSession {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
  tokenType: "Bearer";
  user: {
    id: string;
    email: string;
    name: string | null;
  };
  membership: {
    id: string;
    tenantId: string;
    role: MembershipRoleValue;
  };
  tenant: {
    id: string;
    slug: string;
    name: string;
  };
  backendHttpBase: string;
}

/**
 * OS-keychain-backed storage for auth sessions.
 *
 * Never logs token material. When `safeStorage.isEncryptionAvailable()` is
 * false (e.g. headless CI or a misconfigured user session), we refuse to
 * persist — the caller must keep tokens in memory only.
 */
export class DesktopAuthStorage {
  private readonly filePath: string;

  constructor() {
    this.filePath = path.join(app.getPath("userData"), "auth.json");
  }

  isEncryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  load(): PersistedAuthSession | null {
    try {
      if (!fs.existsSync(this.filePath)) return null;
      if (!this.isEncryptionAvailable()) return null;
      const raw = fs.readFileSync(this.filePath);
      const decrypted = safeStorage.decryptString(raw);
      const parsed = JSON.parse(decrypted) as Partial<PersistedAuthSession>;
      if (!parsed?.accessToken || !parsed?.refreshToken) return null;
      // Legacy sessions (pre-membership schema) are discarded and force a
      // fresh login. Missing `membership` means the token's claims no
      // longer match the backend's schema.
      if (!parsed.membership || !parsed.user || !parsed.tenant) return null;
      return parsed as PersistedAuthSession;
    } catch {
      return null;
    }
  }

  save(session: PersistedAuthSession): void {
    if (!this.isEncryptionAvailable()) {
      throw new Error(
        "safeStorage encryption unavailable — refusing to persist tokens on disk.",
      );
    }
    const payload = JSON.stringify(session);
    const encrypted = safeStorage.encryptString(payload);
    fs.writeFileSync(this.filePath, encrypted, { mode: 0o600 });
    try {
      fs.chmodSync(this.filePath, 0o600);
    } catch {
      /* best-effort on platforms that don't support chmod */
    }
  }

  clear(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        fs.unlinkSync(this.filePath);
      }
    } catch {
      /* noop */
    }
  }
}
