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
  /** Estado de la wallet Cavos en ESTE dispositivo. 'needs-approval': la llave no está aquí (p.ej. tras logout,
   *  que borra la llave del vault) -> signMessage/signXdr fallan con "not an authorized signer". */
  wallet: WalletInfo;
}

export interface WalletInfo {
  state: 'loading' | 'ready' | 'undeployed' | 'needs-approval';
  /** Cavos: ¿se puede recuperar desde otro dispositivo/sesión? (passkey o social). */
  recoveryProtected: boolean;
  hasPasskey: boolean;
  /** Aprobar este dispositivo con la passkey sincronizada (si hay). */
  approveDevice: () => Promise<void>;
  /** Registrar passkey de respaldo (antes de cerrar sesión). */
  enrollPasskey: () => Promise<void>;
}

/** Deriva WalletInfo de useCavos() (web y nativo exponen lo mismo). */
export function walletInfo(c: any): WalletInfo {
  const ws = c.walletStatus ?? {};
  const state: WalletInfo['state'] = ws.needsDeviceApproval ? 'needs-approval' : ws.isReady ? 'ready' : ws.isUndeployed ? 'undeployed' : 'loading';
  return {
    state, recoveryProtected: !!ws.recovery?.protected, hasPasskey: !!ws.hasPasskey,
    approveDevice: () => c.approveDeviceWithPasskey(), enrollPasskey: () => c.enrollPasskeyDefault(),
  };
}
