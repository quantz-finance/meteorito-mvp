// "Descargar app" (solo web, PWA). <InstallButton /> en la bienvenida; <InstallSheetHost /> una vez en el layout raíz
// (abre sola con ?instalar=1, el botón del landing). Chromium/Android: un toque abre el aviso del navegador. iOS: Apple no
// deja instalar por código -> guía de 2 pasos (Compartir -> Agregar a pantalla de inicio). Instagram/Facebook/WhatsApp/
// TikTok o Chrome en iPhone: "Abre este link en Safari" + copiar link. Ya instalada (standalone) o nativo: no se muestra.
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, PrimaryButton, Sheet, toast, type IconName } from '@/components/ds';
import { C, R, S, T } from '@/constants/theme';
import { Fonts } from '@/constants/Colors';
import { track } from '@/lib/analytics';
import { closeInstallSheet, consumeAutoInstall, openInstallSheet, promptInstall, startInstall, useInstall } from '@/lib/install';
import { installLink, type InstallKind } from '@/lib/installCore';

export const INSTALL_LABEL = 'Descargar app';

export function InstallButton({ from = 'welcome' }: { from?: string }) {
  const ins = useInstall();
  if (!ins.visible) return null;
  const hot = ins.auto; // llegó con ?instalar=1: resaltado
  return (
    <Pressable testID="install-app-button" accessibilityRole="button" accessibilityLabel={INSTALL_LABEL} hitSlop={6}
      onPress={() => startInstall(from)}
      style={({ pressed }) => [s.pill, hot && s.pillHot, pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] }]}>
      <Icon name="download-outline" size={18} color={hot ? C.purple : C.lilac} />
      <Text style={[s.pillText, hot && { color: C.purple }]}>{INSTALL_LABEL}</Text>
    </Pressable>
  );
}

function Step({ n, icon, title, hint }: { n: number; icon: IconName; title: string; hint?: string }) {
  return (
    <View style={s.step}>
      <View style={s.stepIcon}><Icon name={icon} size={24} color={C.lilac} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={T.headline}><Text style={{ color: C.lilac }}>{n}. </Text>{title}</Text>
        {hint ? <Text style={T.callout}>{hint}</Text> : null}
      </View>
    </View>
  );
}

const TITLE: Record<InstallKind, string> = {
  prompt: 'Descargar Meteorito',
  ios: 'Agrega Meteorito a tu inicio',
  inapp: 'Abre este link en tu navegador para instalar',
  'ios-other': 'Abre este link en Safari para instalar',
  generic: 'Descargar Meteorito',
};

function copyLink() {
  const url = installLink(typeof window !== 'undefined' ? window.location.origin : 'https://pago.meteorito.app');
  Clipboard.setStringAsync(url).then(() => toast('Link copiado')).catch(() => toast(url, 'info'));
  track('install_link_copied');
}

export function InstallSheetHost() {
  const ins = useInstall();
  const { kind, sheet, visible, env } = ins;
  const title = kind === 'inapp' && env.ios ? 'Abre este link en Safari para instalar' : kind === 'inapp' && env.android ? 'Abre este link en Chrome para instalar' : TITLE[kind];
  // ?instalar=1: iOS / in-app -> la guía de una vez. Chromium: espera el aviso del navegador (llega al ratito) para
  // mostrar el botón grande "Instalar" (prompt() necesita un toque); si no llega, instrucciones del menú.
  const waiting = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!consumeAutoInstall()) return;
    track('install_auto_open', { kind });
    if (kind !== 'generic') { openInstallSheet(); return; }
    waiting.current = setTimeout(() => { waiting.current = null; openInstallSheet(); }, 2500);
    return () => { if (waiting.current) clearTimeout(waiting.current); };
  }, []);
  useEffect(() => { if (ins.hasPrompt && waiting.current) { clearTimeout(waiting.current); waiting.current = null; openInstallSheet(); } }, [ins.hasPrompt]);
  const open = visible && sheet;
  useEffect(() => {
    if (!open) return;
    track('install_sheet_shown', { kind });
    if (kind === 'ios') track('ios_guide_shown');
  }, [open, kind]);
  if (!visible) return null;
  let body: ReactNode;
  let footer: ReactNode = null;
  if (kind === 'prompt') {
    body = <Text style={T.body}>Es gratis, sin tienda de apps. Queda en tu pantalla de inicio y abre como cualquier app.</Text>;
    footer = <PrimaryButton testID="install-sheet-confirm" title="Instalar" icon="download-outline" onPress={() => { void promptInstall('sheet'); }} />;
  } else if (kind === 'ios') {
    body = <>
      <Step n={1} icon="share-outline" title="Toca el botón Compartir" hint="Está abajo en Safari (arriba en iPad). Si no lo ves, toca ••• primero." />
      <Step n={2} icon="add-circle-outline" title={'Elige "Agregar a pantalla de inicio"'} hint={'Puede decir "Agregar a inicio". Luego toca Agregar.'} />
    </>;
    footer = <PrimaryButton title="Entendido" variant="secondary" onPress={closeInstallSheet} />;
  } else if (kind === 'inapp' || kind === 'ios-other') {
    const browser = env.ios ? 'Safari' : env.android ? 'Chrome' : 'tu navegador';
    body = <>
      <Text style={T.body}>{kind === 'inapp' ? `Desde esta app no se puede instalar. Toca ••• arriba y elige "Abrir en el navegador", o copia el link y pégalo en ${browser}.` : `En iPhone solo Safari agrega apps a la pantalla de inicio. Copia el link y pégalo en ${browser}.`}</Text>
      <Step n={1} icon="copy-outline" title="Copia el link" />
      <Step n={2} icon={env.ios ? 'compass-outline' : 'globe-outline'} title={`Pégalo en ${browser}`} hint="Ahí te mostramos cómo instalarla." />
    </>;
    footer = <PrimaryButton testID="install-copy-link" title="Copiar link" icon="copy-outline" onPress={copyLink} />;
  } else {
    body = <>
      <Step n={1} icon="ellipsis-horizontal" title="Abre el menú del navegador" hint="El botón ⋮ o ••• arriba o abajo de la pantalla." />
      <Step n={2} icon="download-outline" title={'Elige "Instalar app"'} hint={'O "Agregar a pantalla de inicio".'} />
    </>;
    footer = <PrimaryButton title="Entendido" variant="secondary" onPress={closeInstallSheet} />;
  }
  return (
    <Sheet visible={open} onClose={closeInstallSheet} title={title} footer={footer}>
      <View testID="install-sheet" style={{ gap: S.md }}>{body}</View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: S.md, borderRadius: R.pill, backgroundColor: C.lilacBg, borderWidth: 1, borderColor: 'rgba(196,167,255,0.35)' },
  pillHot: { backgroundColor: C.white, borderColor: C.white },
  pillText: { fontFamily: Fonts.bold, fontSize: 15, color: C.lilac },
  step: { flexDirection: 'row', alignItems: 'center', gap: S.md, backgroundColor: C.lilacBg, borderRadius: R.md, padding: S.md },
  stepIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(108,43,217,0.35)', alignItems: 'center', justifyContent: 'center' },
});
