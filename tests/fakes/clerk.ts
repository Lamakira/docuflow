/**
 * In-memory stand-in for the `@clerk/backend` package (ADR-0018: fakes only).
 *
 * `vitest.config.ts` aliases `@clerk/backend` here, so the IdentityProvider
 * adapter never reaches api.clerk.com. Tests of the port use
 * `tests/fakes/identityProvider.ts`; this module exists so loading the adapter
 * under test still cannot call Clerk.
 */

import bcrypt from "bcrypt";

export type CreateUserParams = {
  emailAddress?: string[];
  passwordDigest?: string;
  passwordHasher?: string;
  firstName?: string;
  lastName?: string;
};

export type CreateInvitationParams = {
  emailAddress: string;
  redirectUrl?: string;
};

type StoredUser = {
  id: string;
  email: string;
  passwordDigest: string;
  emailAddresses: Array<{ emailAddress: string }>;
};

type StoredInvitation = {
  id: string;
  emailAddress: string;
  status: string;
};

const users: StoredUser[] = [];
const createUserCalls: CreateUserParams[] = [];
const invitations: StoredInvitation[] = [];
const createInvitationCalls: CreateInvitationParams[] = [];
const sessions = new Map<string, { sub: string }>();

export function createClerkClient(_options: { secretKey?: string; publishableKey?: string }) {
  return {
    users: {
      createUser: async (params: CreateUserParams) => {
        createUserCalls.push(params);
        const email = params.emailAddress?.[0];
        if (!email) throw new Error("emailAddress is required");
        const id = `user_test_${users.length + 1}`;
        const stored: StoredUser = {
          id,
          email,
          passwordDigest: params.passwordDigest ?? "",
          emailAddresses: [{ emailAddress: email }],
        };
        users.push(stored);
        return stored;
      },
      getUserList: async (params: { emailAddress?: string[] }) => {
        const email = params.emailAddress?.[0];
        const data = email ? users.filter((user) => user.email === email) : [...users];
        return { data, totalCount: data.length };
      },
      getUser: async (id: string) => {
        const user = users.find((entry) => entry.id === id);
        if (!user) throw new Error(`No User ${id}`);
        return user;
      },
      verifyPassword: async (params: { userId: string; password: string }) => {
        const user = users.find((entry) => entry.id === params.userId);
        if (!user || !(await bcrypt.compare(params.password, user.passwordDigest))) {
          throw new Error("invalid password");
        }
        return { verified: true as const };
      },
    },
    invitations: {
      createInvitation: async (params: CreateInvitationParams) => {
        createInvitationCalls.push(params);
        if (!params.emailAddress) throw new Error("emailAddress is required");
        // Clerk refuses a second pending invitation for the same address; the
        // adapter is expected to look before it sends, and this proves it does.
        if (invitations.some((entry) => entry.emailAddress === params.emailAddress)) {
          throw new Error(`duplicate invitation for ${params.emailAddress}`);
        }
        const stored: StoredInvitation = {
          id: `inv_test_${invitations.length + 1}`,
          emailAddress: params.emailAddress,
          status: "pending",
        };
        invitations.push(stored);
        return stored;
      },
      getInvitationList: async (params: { status?: string } = {}) => {
        const data = params.status
          ? invitations.filter((entry) => entry.status === params.status)
          : [...invitations];
        return { data, totalCount: data.length };
      },
    },
  };
}

export async function verifyToken(token: string, _options: { secretKey?: string }) {
  const payload = sessions.get(token);
  if (!payload) throw new Error("invalid token");
  return payload;
}

/** Test helper — not on the port. */
export function issueClerkSession(providerSubjectId: string): string {
  const token = `sess_test_${providerSubjectId}`;
  sessions.set(token, { sub: providerSubjectId });
  return token;
}

export function clerkCreateUserCalls(): CreateUserParams[] {
  return createUserCalls;
}

export function clerkCreateInvitationCalls(): CreateInvitationParams[] {
  return createInvitationCalls;
}

export function resetClerk(): void {
  users.length = 0;
  createUserCalls.length = 0;
  invitations.length = 0;
  createInvitationCalls.length = 0;
  sessions.clear();
}
