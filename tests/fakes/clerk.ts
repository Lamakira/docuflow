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

type StoredEmailAddress = {
  id: string;
  emailAddress: string;
  verification: { status: string } | null;
};

type StoredUser = {
  id: string;
  email: string;
  passwordDigest: string;
  emailAddresses: StoredEmailAddress[];
  primaryEmailAddressId: string | null;
  firstName: string | null;
  lastName: string | null;
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
        // Clerk treats an address it created from a verified import, or one the
        // person answered a challenge for, as verified and primary. That is the
        // ordinary case, so it is the default here; `plantClerkUser` builds the
        // ones that are not.
        const addressId = `idn_test_${users.length + 1}`;
        const stored: StoredUser = {
          id,
          email,
          passwordDigest: params.passwordDigest ?? "",
          emailAddresses: [
            { id: addressId, emailAddress: email, verification: { status: "verified" } },
          ],
          primaryEmailAddressId: addressId,
          firstName: params.firstName ?? null,
          lastName: params.lastName ?? null,
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
  // Match @clerk/backend: JwtReturnType<{ data } | { errors }>
  return { data: payload };
}

/** Test helper — not on the port. */
export function issueClerkSession(providerSubjectId: string): string {
  const token = `sess_test_${providerSubjectId}`;
  sessions.set(token, { sub: providerSubjectId });
  return token;
}

/**
 * Test helper — not on the Clerk surface. A Clerk User whose addresses are not
 * the ordinary one-verified-primary shape: an unconfirmed address, or a
 * secondary sitting ahead of the primary in the list. Both are what
 * `findIdentityBySubjectId` has to refuse to build a `users` row from (#230).
 */
export function plantClerkUser(input: {
  addresses: Array<{ email: string; verified?: boolean; primary?: boolean }>;
}): string {
  const id = `user_test_${users.length + 1}`;
  const addresses: StoredEmailAddress[] = input.addresses.map((address, index) => ({
    id: `idn_planted_${users.length + 1}_${index}`,
    emailAddress: address.email,
    verification: address.verified === false ? { status: "unverified" } : { status: "verified" },
  }));
  const primary = input.addresses.findIndex((address) => address.primary === true);
  users.push({
    id,
    email: addresses[0]?.emailAddress ?? "",
    passwordDigest: "",
    emailAddresses: addresses,
    primaryEmailAddressId: primary >= 0 ? addresses[primary].id : null,
    firstName: null,
    lastName: null,
  });
  return id;
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
