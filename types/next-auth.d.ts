// Two Auth.js instances share these declarations: clinic sessions carry
// uid/cid, operator sessions carry oid. Readers validate which is present.
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface User {
    clinicId?: string;
    sessionVersion?: number;
  }

  interface Session {
    /** Clinic staff user id */
    uid?: string;
    /** Clinic id */
    cid?: string;
    /** Platform operator id */
    oid?: string;
    /** Session version at sign-in */
    sv?: number;
    /** Sign-in time (ms): the absolute session limit counts from here */
    loginAt?: number;
    /** Server-minted proof accompanying a session-version update (lib/auth/session-proof.ts) */
    proof?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    cid?: string;
    oid?: string;
    sv?: number;
    loginAt?: number;
  }
}
