import type {
  User,
  SafeUser,
  InsertUser,
  Device,
  InsertDevice,
  AgentPairingCode,
} from "@shared/schema";
import type { UserImportPersistence } from "./userImport";
import type { DualAuthPersistence } from "./dualAuth";

export interface IdentityPersistence extends UserImportPersistence, DualAuthPersistence {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(userData: InsertUser): Promise<User>;
  upsertUser(userData: {
    id: string;
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    profileImageUrl?: string | null;
  }): Promise<User>;

  getMainAdmin(): Promise<SafeUser | undefined>;
  getAllUsers(opts?: { includeArchived?: boolean }): Promise<SafeUser[]>;
  archiveUser(userId: string, isArchived: boolean): Promise<SafeUser | undefined>;
  updateUserRole(userId: string, role: string): Promise<SafeUser | undefined>;
  updateUser(
    userId: string,
    data: {
      firstName?: string;
      lastName?: string;
      email?: string;
      hoursPerDay?: number;
      canViewDailyUpdates?: number;
    }
  ): Promise<SafeUser | undefined>;
  updateUserPassword(
    userId: string,
    hashedPassword: string,
    plainPassword?: string
  ): Promise<SafeUser | undefined>;
  updateUserLastLogin(userId: string): Promise<void>;
  getAdminUserDetails(userId: string): Promise<User | undefined>;
  deleteUser(userId: string): Promise<void>;
  getUserWithPassword(userId: string): Promise<User | undefined>;

  createAgentPairingCode(data: {
    userId: string;
    code: string;
    expiresAt: Date;
  }): Promise<AgentPairingCode>;
  getAgentPairingCode(code: string): Promise<AgentPairingCode | undefined>;
  markPairingCodeUsed(id: string): Promise<void>;

  createDevice(data: InsertDevice): Promise<Device>;
  getDevice(id: string): Promise<Device | undefined>;
  getDeviceByTokenHash(deviceId: string, tokenHash: string): Promise<Device | undefined>;
  updateDeviceLastSeen(id: string): Promise<void>;
  revokeDevice(id: string): Promise<void>;
  revokeDevicesByMachine(userId: string, name: string, os: string | null): Promise<void>;
  getUserDevices(userId: string): Promise<Device[]>;
  getAdminAllDevices(): Promise<
    Array<{
      id: string;
      userId: string;
      userName: string;
      name: string;
      os: string | null;
      clientVersion: string | null;
      lastSeenAt: Date | null;
      revokedAt: Date | null;
      createdAt: Date | null;
    }>
  >;
}
