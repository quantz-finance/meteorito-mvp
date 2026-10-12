export interface MeteoritoAuth {
  configured: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  email: string | null;
  address: string | null;
  error: string | null;
  openLogin: () => void;
  logout: () => Promise<void> | void;
}
