// Cámara dentro de la app (fotos "solo cámara": prueba de envío, producto nuevo y disputa).
// getUserMedia (cámara trasera) con vista previa en vivo, botón de disparo y captura del cuadro a canvas con la MARCA
// (fecha y hora de Costa Rica + código del pedido o producto) -> JPEG comprimido -> subida con el token de captura de un uso
// que se pidió al abrir. Sin selector de archivos, sin galería y sin el atributo de captura de un campo de archivo. Si no hay cámara o se niega el permiso, se
// explica cómo activarla (Safari, app en la pantalla de inicio) en vez de caer al carrete.
// Modo demo/e2e: cámara simulada (cuadro sintético dibujado en un canvas); `?camera=denied|busy|unsupported` simula fallas.
// PostHog: camera_opened / camera_captured / camera_denied con etapa (propósito). Nunca se manda la imagen.
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ErrorText, haptic, Icon, PrimaryButton } from '@/components/ds';
import { C, R, S, T } from '@/constants/theme';
import { Fonts } from '@/constants/Colors';
import { useAuth } from '@/lib/cavos';
import { DEMO_ENABLED } from '@/lib/demo';
import { track } from '@/lib/analytics';
import { userMessage } from '@/lib/cavosSession';
import { CAMERA_MAX_SIDE, canvasToJpeg, uploadCaptured } from '@/lib/photos';
import { photoFailureProps } from '@/lib/photoError';
import { cameraEnv, cameraHelp, captureNow, classifyCameraError, requestCaptureToken, stampLines, tokenFresh,
  type CameraFailure, type CapturedPhoto, type CapturePurpose, type CaptureToken } from '@/lib/capture';

const TITLES: Record<CapturePurpose, string> = { ship: 'Foto del envío', listing: 'Foto del producto', dispute: 'Foto del problema' };
const HINTS: Record<CapturePurpose, string> = {
  ship: 'El paquete o el comprobante de Correos, en este momento.',
  listing: 'El producto real, con buena luz.',
  dispute: 'Muestra el problema tal como llegó.',
};

/** Cámara simulada SOLO en modo demo (nunca en producción: DEMO_ENABLED se apaga en los dominios reales). */
function fakeCamera(): null | 'ok' | 'denied' | 'busy' | 'unsupported' {
  if (!DEMO_ENABLED || typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search).get('camera');
  const v = q ?? (() => { try { return window.sessionStorage.getItem('meteorito:fake-camera'); } catch { return null; } })();
  return v === 'denied' || v === 'busy' || v === 'unsupported' ? v : 'ok';
}
const fakeError = (k: 'denied' | 'busy' | 'unsupported') => Object.assign(new Error(k), { name: k === 'denied' ? 'NotAllowedError' : k === 'busy' ? 'NotReadableError' : 'NotSupportedError' });

/** Cuadro sintético de la cámara simulada: una "caja" sobre una mesa, que se mueve un poco (se ve en vivo). */
function drawFake(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#5b4a3a'); g.addColorStop(1, '#2c2219');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const dx = Math.sin(t / 700) * w * 0.02, bw = w * 0.5, bh = h * 0.32, x = (w - bw) / 2 + dx, y = h * 0.34;
  ctx.fillStyle = '#c89b62'; ctx.fillRect(x, y, bw, bh);
  ctx.fillStyle = '#b2834d'; ctx.fillRect(x, y, bw, bh * 0.18);
  ctx.fillStyle = '#e9d8b4'; ctx.fillRect(x + bw * 0.42, y, bw * 0.16, bh);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(x + bw * 0.08, y + bh * 0.45, bw * 0.3, bh * 0.3);
  ctx.fillStyle = '#333'; ctx.font = `${Math.round(bh * 0.07)}px sans-serif`; ctx.fillText('CORREOS CR', x + bw * 0.1, y + bh * 0.58);
}

/** Marca de evidencia abajo de la foto: banda oscura + fecha/hora CR + código. */
function drawStamp(ctx: CanvasRenderingContext2D, w: number, h: number, lines: string[]) {
  const fs = Math.max(14, Math.round(Math.min(w, h) * 0.04)); const pad = Math.round(fs * 0.6);
  const bandH = lines.length * fs * 1.3 + pad * 1.4;
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, h - bandH, w, bandH);
  ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'top';
  lines.forEach((l, i) => { ctx.font = `${i === 0 ? 'bold ' : ''}${fs}px -apple-system, Helvetica, Arial, sans-serif`; ctx.fillText(l, pad, h - bandH + pad * 0.7 + i * fs * 1.3); });
}

type Phase = 'starting' | 'live' | 'review' | 'uploading' | 'failed';

export function CameraCapture({ visible, purpose, refId, asGuest = false, asSeller = false, title, hint, onClose, onDone }: {
  visible: boolean; purpose: CapturePurpose; /** slug del pedido (ship/dispute) o 'new' (producto) */ refId: string;
  /** comprador sin cuenta (invitación o disputa con su llave) */ asGuest?: boolean;
  /** vendedor respondiendo una disputa (foto en su carpeta) */ asSeller?: boolean; title?: string; hint?: string;
  onClose: () => void; onDone: (p: CapturedPhoto) => void;
}) {
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>('starting');
  const [failure, setFailure] = useState<CameraFailure | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shot, setShot] = useState<{ blob: Blob; uri: string; at: number } | null>(null);
  const [tok, setTok] = useState<CaptureToken | null>(null);
  const [clock, setClock] = useState(Date.now());
  const video = useRef<any>(null);
  const fakeCanvas = useRef<any>(null);
  const stream = useRef<MediaStream | null>(null);
  const raf = useRef<number | null>(null);
  const openedAt = useRef(0);

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null;
    if (raf.current != null) cancelAnimationFrame(raf.current); raf.current = null;
  }, []);

  const start = useCallback(async () => {
    setPhase('starting'); setFailure(null); setErr(null); setShot(null);
    openedAt.current = Date.now();
    track('camera_opened', { stage: purpose, standalone: cameraEnv().standalone });
    const fake = fakeCamera();
    // Token de un uso en paralelo con el permiso de cámara.
    const tokenP = requestCaptureToken(auth, purpose, refId, asGuest, asSeller).then((t) => { setTok(t); return t; });
    try {
      if (fake && fake !== 'ok') throw fakeError(fake);
      if (!fake) {
        const md: any = typeof navigator !== 'undefined' ? (navigator as any).mediaDevices : null;
        if (!md?.getUserMedia) throw Object.assign(new Error('sin getUserMedia'), { name: 'NotSupportedError' });
        let s: MediaStream;
        try { s = await md.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } } }); }
        catch (e: any) { if (e?.name !== 'OverconstrainedError') throw e; s = await md.getUserMedia({ audio: false, video: true }); }
        stream.current = s;
      }
    } catch (e) {
      const kind = classifyCameraError(e);
      tokenP.catch(() => {});
      track('camera_denied', { stage: purpose, reason: kind, standalone: cameraEnv().standalone });
      setFailure(kind); setPhase('failed'); return;
    }
    try { await tokenP; }
    catch (e: any) {
      stop(); track('camera_denied', { stage: purpose, reason: 'token', code: String(e?.code ?? 'unknown').slice(0, 40) });
      setFailure('token'); setErr(userMessage(e?.message ?? '')); setPhase('failed'); return;
    }
    setPhase('live');
  }, [auth, purpose, refId, asGuest, asSeller, stop]);

  useEffect(() => { if (visible) start(); else { stop(); setTok(null); } return () => stop(); }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Conectar el stream al <video> (o animar la cámara simulada) cuando la vista previa está montada.
  useEffect(() => {
    if (phase !== 'live') return;
    if (stream.current && video.current) {
      const v = video.current as HTMLVideoElement;
      v.srcObject = stream.current; v.setAttribute('playsinline', 'true'); v.muted = true; v.play?.().catch(() => {});
    }
    if (!stream.current && fakeCanvas.current) {
      const cv = fakeCanvas.current as HTMLCanvasElement; const ctx = cv.getContext('2d')!;
      const loop = () => { drawFake(ctx, cv.width, cv.height, Date.now()); raf.current = requestAnimationFrame(loop); };
      loop();
    }
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => { clearInterval(t); if (raf.current != null) cancelAnimationFrame(raf.current); raf.current = null; };
  }, [phase]);

  async function capture() {
    if (!tok) return;
    const src: any = stream.current ? video.current : fakeCanvas.current;
    const vw = stream.current ? src?.videoWidth : src?.width; const vh = stream.current ? src?.videoHeight : src?.height;
    if (!src || !vw || !vh) { setErr('La cámara todavía no está lista. Intenta de nuevo.'); return; }
    haptic.tap();
    const scale = Math.min(1, CAMERA_MAX_SIDE / Math.max(vw, vh));
    const w = Math.round(vw * scale), h = Math.round(vh * scale);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(src, 0, 0, w, h);
    const at = captureNow(tok);
    drawStamp(ctx, w, h, stampLines(at, tok.code));
    const blob = await canvasToJpeg(cv);
    setShot({ blob, uri: URL.createObjectURL(blob), at });
    track('camera_captured', { stage: purpose, ms_open: Date.now() - openedAt.current, kb: Math.round(blob.size / 1024) });
    setPhase('review');
  }

  async function use() {
    if (!shot || !tok) return;
    if (!tokenFresh(tok)) { setErr('Pasaron más de 5 minutos. Toma la foto de nuevo.'); start(); return; }
    setPhase('uploading'); setErr(null);
    try {
      const url = await uploadCaptured(auth, shot.blob, { token: tok.token, purpose }, asGuest, asSeller);
      stop(); haptic.success();
      onDone({ url, uri: shot.uri, token: tok.token, token_id: tok.id, captured_at: new Date(shot.at).toISOString(), purpose });
    } catch (e: any) {
      haptic.error(); track('photo_upload_failed', { context: 'camera_' + purpose, ...photoFailureProps(e) });
      // Token usado o vencido: se pide otro y se toma de nuevo (nunca se reutiliza).
      if (/capture_token_(used|expired)|capture_token_invalid/.test(String(e?.code))) { setErr(userMessage(e?.message ?? '')); start(); return; }
      setErr(userMessage(e?.message ?? 'No se pudo subir la foto.')); setPhase('review');
    }
  }

  const close = () => { stop(); onClose(); };
  const help = failure ? cameraHelp(failure, cameraEnv()) : null;
  const web = Platform.OS === 'web';
  const fakeMode = !!fakeCamera();

  return (
    <Modal visible={visible} transparent={false} animationType="none" onRequestClose={close} statusBarTranslucent>
      <View testID="camera-capture" style={[st.root, { paddingTop: insets.top + S.sm, paddingBottom: Math.max(insets.bottom, S.md) }]}>
        <View style={st.top}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[T.headline, { color: C.white }]} numberOfLines={1}>{title ?? TITLES[purpose]}</Text>
            <Text style={[T.footnote, { color: 'rgba(255,255,255,0.75)' }]} numberOfLines={2}>{hint ?? HINTS[purpose]}</Text>
          </View>
          <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Cerrar cámara" hitSlop={8} style={st.round}><Icon name="close" size={22} color={C.white} /></Pressable>
        </View>

        <View style={st.stage}>
          {phase === 'failed' && help ? (
            <View testID="camera-denied" style={st.fail}>
              <View style={st.failIcon}><Icon name="videocam-off-outline" size={30} color={C.orange} /></View>
              <Text style={[T.title, { color: C.white, textAlign: 'center' }]}>{help.title}</Text>
              <Text style={[T.callout, { color: 'rgba(255,255,255,0.85)', textAlign: 'center' }]}>{help.body}</Text>
              {err && failure === 'token' ? <ErrorText>{err}</ErrorText> : null}
              <Text style={[T.footnote, { color: 'rgba(255,255,255,0.6)', textAlign: 'center' }]}>Por seguridad, esta foto solo se puede tomar con la cámara en este momento.</Text>
            </View>
          ) : phase === 'review' || phase === 'uploading' ? (
            shot ? <Image testID="camera-shot" source={{ uri: shot.uri }} style={st.media} resizeMode="contain" accessibilityLabel="Foto tomada con la fecha y el código" /> : null
          ) : web ? (
            <View style={st.media}>
              {fakeMode
                ? createElement('canvas', { ref: fakeCanvas, width: 960, height: 1280, 'data-testid': 'camera-preview', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } })
                : createElement('video', { ref: video, playsInline: true, muted: true, autoPlay: true, 'data-testid': 'camera-preview', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block', backgroundColor: '#000' } })}
              {phase === 'live' && tok ? (
                <View pointerEvents="none" style={st.stampPreview}>
                  {stampLines(captureNow(tok, clock), tok.code).map((l, i) => <Text key={i} style={[st.stampText, i === 0 && { fontFamily: Fonts.bold }]} numberOfLines={1}>{l}</Text>)}
                </View>
              ) : null}
              {phase === 'starting' ? <View style={[StyleSheet.absoluteFill, st.center]}><ActivityIndicator color={C.white} /></View> : null}
            </View>
          ) : (
            <View style={[st.media, st.center]}><Text style={[T.callout, { color: C.white }]}>Abre Meteorito en el navegador de tu teléfono para usar la cámara.</Text></View>
          )}
          {phase === 'uploading' ? <View style={[StyleSheet.absoluteFill, st.center, { backgroundColor: 'rgba(0,0,0,0.35)' }]}><ActivityIndicator color={C.white} size="large" /></View> : null}
        </View>

        <View style={st.bottom}>
          {err && failure !== 'token' ? <ErrorText>{err}</ErrorText> : null}
          {phase === 'failed' ? (
            <View style={{ gap: S.sm }}>
              <PrimaryButton title="Reintentar" icon="refresh" onPress={start} />
              <PrimaryButton title="Cancelar" variant="secondary" onPress={close} />
            </View>
          ) : phase === 'review' || phase === 'uploading' ? (
            <View style={{ flexDirection: 'row', gap: S.sm }}>
              <View style={{ flex: 1 }}><PrimaryButton title="Repetir" icon="camera-outline" variant="secondary" disabled={phase === 'uploading'} onPress={() => { setErr(null); setShot(null); if (tok && tokenFresh(tok)) setPhase('live'); else start(); }} /></View>
              <View style={{ flex: 1 }}><PrimaryButton title="Usar foto" icon="checkmark" loading={phase === 'uploading'} onPress={use} /></View>
            </View>
          ) : (
            <View style={st.center}>
              <Pressable testID="camera-shutter" onPress={capture} disabled={phase !== 'live'} accessibilityRole="button" accessibilityLabel="Tomar foto"
                style={({ pressed }) => [st.shutter, phase !== 'live' && { opacity: 0.4 }, pressed && { transform: [{ scale: 0.94 }] }]}>
                <View style={st.shutterIn} />
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', paddingHorizontal: S.md, gap: S.sm },
  top: { flexDirection: 'row', alignItems: 'center', gap: S.sm, minHeight: 44 },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  stage: { flex: 1, borderRadius: R.lg, overflow: 'hidden', backgroundColor: '#111' },
  media: { flex: 1, width: '100%', height: '100%' },
  center: { alignItems: 'center', justifyContent: 'center' },
  stampPreview: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: S.sm + 4, paddingVertical: S.sm, backgroundColor: 'rgba(0,0,0,0.55)' },
  stampText: { color: '#fff', fontFamily: Fonts.regular, fontSize: 14, lineHeight: 18 },
  fail: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: S.md, padding: S.lg },
  failIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  bottom: { gap: S.sm, minHeight: 84, justifyContent: 'center' },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterIn: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
});
