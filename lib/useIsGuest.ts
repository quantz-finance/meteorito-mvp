// Sin sesión de vendedor (Cavos con dirección): comprador invitado, con su llave en este dispositivo.
import { useAuth } from './cavos';
export function useIsGuest() {
  const auth = useAuth();
  return !(auth.isAuthenticated && auth.address);
}
