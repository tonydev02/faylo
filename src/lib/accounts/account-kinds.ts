export const ACCOUNT_KINDS = ["bank", "cash", "investment"] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];
