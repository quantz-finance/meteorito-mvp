export interface MeteoritoAuth {
  configured: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  email: string | null;
  address: string | null;
  error: string | null;
  openLogin: () => void;
  logout: () => Promise<void> | void;
  /** JWT de Cavos de la sesión (se verifica server-side). null si no hay. */
  getAuthToken: () => string | null;
  /** Firma off-chain con el control key Stellar (prueba de dirección). */
  signMessage: (message: string) => Promise<{ publicKey: string; signature: string }>;
  /** Firma un XDR externo (Trustless Work) sin enviarlo. */
  signXdr: (unsignedXdr: string) => Promise<string>;
}
