// Bandeja de mensajes: /mensajes?as=s (vendedor, con sesión) o /mensajes?as=b (comprador, llave de este dispositivo).
// Sin pestaña nueva: se entra desde Home (vendedor) o desde Comprar › Mis compras (comprador). Lista con foto o
// inicial, nombre, producto o compra, último mensaje ("Tú: …"), hora y punto de no leído. Se refresca cada 10 s
// con la pantalla visible y al volver a ella. Vendedor: si la pregunta vino de un producto, su miniatura (cuadrada) y su
// título en la fila, para saber de qué producto te preguntan sin abrir la conversación.
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, haptic, Icon, Screen, SkeletonCard } from '@/components/ds';
import { pressTransition } from '@/constants/motion';
import { Fonts } from '@/constants/Colors';
import { C, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { chatHref, listChats, listTime, setUnread, type ChatListItem, type ChatRole } from '@/lib/chat';
import { COPY } from '@/lib/copy';

const K = COPY.chat;
const LIST_POLL_MS = 10_000;

export default function Mensajes() {
  const { as: asParam } = useLocalSearchParams<{ as?: string }>();
  const as: ChatRole = asParam === 's' || asParam === 'seller' ? 'seller' : 'buyer';
  const auth = useAuth();
  const [rows, setRows] = useState<ChatListItem[] | null>(null);
  const [err, setErr] = useState(false);

  useFocusEffect(useCallback(() => {
    if (as === 'seller' && !auth.isAuthenticated) { router.replace('/pedidos'); return; }
    let live = true;
    const load = () => listChats(auth, as).then((r) => { if (!live) return; setRows(r.conversations); setErr(false); setUnread(as, r.unread, r.conversations.length); })
      .catch(() => { if (live) { setErr(true); setRows((p) => p ?? []); } });
    void load();
    const visible = () => Platform.OS !== 'web' || typeof document === 'undefined' || !document.hidden;
    const id = setInterval(() => { if (visible()) void load(); }, LIST_POLL_MS);
    return () => { live = false; clearInterval(id); };
  }, [as, auth.isAuthenticated])); // eslint-disable-line react-hooks/exhaustive-deps

  const title = as === 'seller' ? K.inboxSeller : K.inboxBuyer;
  return (
    <Screen title={title} back={as === 'seller' ? '/pedidos' : '/comprar/compras'} space="calm">
      {rows === null ? <><SkeletonCard /><SkeletonCard /></>
        : rows.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: S.xl, gap: S.md }}>
            <Icon name="chatbubbles-outline" size={40} color={C.lilac} />
            <Text testID="inbox-empty" style={[T.headline, { textAlign: 'center' }]}>{err ? K.loadError : K.inboxEmpty}</Text>
            {!err ? <Text style={[T.callout, { textAlign: 'center' }]}>{as === 'seller' ? K.inboxEmptySeller : K.inboxEmptyBuyer}</Text> : null}
          </Card>
        ) : (
          <View style={s.list} testID="inbox-list">
            {rows.map((c, i) => <Row key={c.token} c={c} as={as} last={i === rows.length - 1} />)}
          </View>
        )}
    </Screen>
  );
}

function Row({ c, as, last }: { c: ChatListItem; as: ChatRole; last: boolean }) {
  const mine = c.last_sender === as;
  const about = c.kind === 'order' ? `${K.order}${c.subject ? ` · ${c.subject}` : ''}` : c.subject ?? null;
  const a11y = `${c.name}${about ? `, ${about}` : ''}. ${mine ? K.you : ''}${c.last_preview}. ${listTime(c.last_message_at)}${c.unread ? `. ${K.unreadA11y(1)}` : ''}`;
  const item = as === 'seller' && c.kind === 'store' && !!c.subject; // pregunta desde un producto
  return (
    <Pressable testID="inbox-row" accessibilityRole="button" accessibilityLabel={a11y}
      onPress={() => { haptic.tap(); router.push(`${chatHref(c.token, as)}&src=inbox` as never); }}
      style={({ pressed }) => [s.row, !last && s.rowLine, pressTransition, pressed && { backgroundColor: 'rgba(201,182,255,0.08)' }]}>
      {item ? (c.photo ? <Image testID="inbox-item-thumb" source={{ uri: c.photo }} style={s.thumb} accessibilityIgnoresInvertColors />
          : <View testID="inbox-item-thumb" style={[s.thumb, s.thumbEmpty]}><Icon name="pricetag-outline" size={22} color={C.lilac} /></View>)
        : c.photo ? <Image source={{ uri: c.photo }} style={s.avatar} accessibilityIgnoresInvertColors />
        : <View style={s.avatar}>{as === 'seller' ? <Icon name="person" size={22} color={C.purpleDark} />
          : <Text style={[T.headline, { color: C.purpleDark }]}>{(c.name || '?').charAt(0).toUpperCase()}</Text>}</View>}
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
          <Text style={[T.headline, { flex: 1 }]} numberOfLines={1}>{c.name}</Text>
          <Text style={[T.footnote, c.unread && { color: C.lilac, fontFamily: Fonts.bold }]}>{listTime(c.last_message_at)}</Text>
        </View>
        {about ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Icon name={c.kind === 'order' ? 'bag-check-outline' : 'pricetag-outline'} size={12} color={C.textDim} />
          <Text style={[T.footnote, { flex: 1 }, item && { color: C.text }]} numberOfLines={1} testID={item ? 'inbox-item-title' : undefined}>{about}</Text>
        </View> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
          <Text style={[T.callout, { flex: 1 }, c.unread && { color: C.text, fontFamily: Fonts.bold }]} numberOfLines={1}>
            {c.blocked ? <Icon name="ban-outline" size={12} color={C.textDim} /> : null}{c.blocked ? ' ' : ''}{mine ? K.you : ''}{c.last_preview}
          </Text>
          {c.unread ? <View testID="inbox-unread" style={s.unread} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  list: { backgroundColor: C.surface, borderRadius: 16, borderWidth: 0.5, borderColor: C.line, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: S.sm + 4, paddingHorizontal: S.sm + 4, paddingVertical: S.sm + 4, minHeight: 72 },
  rowLine: { borderBottomWidth: 0.5, borderBottomColor: C.line },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.lilac, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumb: { width: 48, height: 48, borderRadius: 10, backgroundColor: C.lilacBg, overflow: 'hidden' },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  unread: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.orange },
});
