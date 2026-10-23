// "/" (inicio de la PWA, links viejos, post-login): la app abre en Vender. Ya no hay pantalla de Inicio.
import { Redirect } from 'expo-router';

export default function Root() {
  return <Redirect href="/vender" />;
}
