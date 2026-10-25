/**
 * The PC's tailnet name (`pc1.tailXXXX.ts.net`). Set as an EAS environment
 * variable and in `.env.local`, never in this public repository.
 */
export const ARKADIA_HOST = process.env.EXPO_PUBLIC_ARKADIA_HOST ?? "";
