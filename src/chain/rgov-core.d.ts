// Types for the vendored plain-JS rgov-core.js.
export const INBOX_RHO: string;
export const GROUP_RHO: string;
export const ISSUE_RHO: string;
export function installInboxProgram(): string;
export function installGroupProgram(): string;
export function installIssueProgram(): string;
export function writeProgram(uri: string, facet: string, verb: string, args?: string[], opts?: { asAdmin?: boolean }): string;
export function readProgram(uri: string, verb: string, args?: string[]): string;
export function selftest(): boolean;
