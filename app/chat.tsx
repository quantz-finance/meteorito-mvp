// Conversación comprador-vendedor: /chat?c=<token>&r=b|s (el token va en el query: la analítica descarta el query).
// Texto solo (v1). Burbujas con hora y estado (enviando / enviado / leído), "escribiendo…", separadores de día, envío
// optimista (reintento sin duplicar), respuestas rápidas para el comprador, aviso suave si se comparte un teléfono o un
// link antes de pagar, compositor fijo abajo (letra 16 px). Polling inteligente (lib/chat.ts). Opciones: ver el
// producto o la compra, Reportar y (vendedor) Bloquear. Sin la migración 025 muestra un aviso amable.
// Desde la ficha de un producto (?p=<slug>), estilo Messenger: el primer mensaje lleva la tarjeta del producto (foto,
// título, precio; tocar abre /p/<slug>) y cada producto nuevo de la misma tienda agrega la suya (030; sin ella, la de arriba).
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { goBack } from '@/components/BackButton';
import { haptic, Icon, IconButton, ListRow, PrimaryButton, Sheet, Skeleton, st, toast, type IconName } from '@/components/ds';
import { SpaceBackground } from '@/components/space';
import { anim, pressTransition } from '@/constants/motion';
import { Fonts } from '@/constants/Colors';
import { C, R, S, T, TOUCH } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/cavos';
import {
  blockChat, CHAT_MAX, chatPollDelay, dayLabel, hhmm, itemCardRows, mergeMessages, newClientId, readChat, refreshUnread, reportChat, sendChat, sharesContact,
  type ChatConversation, type ChatMsg, type ChatProduct, type ChatRole,
} from '@/lib/chat';
import { COPY } from '@/lib/copy';
import { formatCRC, STATUS_LABEL } from '@/lib/orders';

const K = COPY.chat;
const lenBucket = (n: number) => (n < 20 ? '<20' : n < 100 ? '<100' : n < 500 ? '<500' : '>=500');

export default function ChatScreen() {
  const { c: token, r, src, p: fromItem } = useLocalSearchParams<{ c?: string; r?: string; src?: string; p?: string }>();
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const [role, setRole] = useState<ChatRole>(r === 's' ? 'seller' : 'buyer');
  const [conv, setConv] = useState<ChatConversation | null>(null);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [products, setProducts] = useState<Record<string, ChatProduct>>({});
  const addProducts = (p?: Record<string, ChatProduct>) => { if (p && Object.keys(p).length) setProducts((cur) => ({ ...cur, ...p })); };
  const noMarkers = useRef(false); // el servidor no guarda tarjetas (sin 030): no dibujarlas en el envío optimista
  const [state, setState] = useState<{ blocked: boolean; other_read_at: string | null; other_typing: boolean; has_more: boolean }>({ blocked: false, other_read_at: null, other_typing: false, has_more: false });
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [menu, setMenu] = useState(false);
  const [canBlock, setCanBlock] = useState(true); // vendedor: false con una compra en curso o una disputa abierta (el servidor lo vuelve a comprobar)
  const [report, setReport] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const nearBottom = useRef(true);
  const lastActivity = useRef(Date.now());
  const lastTyped = useRef(0);
  const roleRef = useRef(role); roleRef.current = role;
  const msgsRef = useRef(msgs); msgsRef.current = msgs;
  const fallback = role === 'seller' ? '/pedidos' : '/comprar/compras';

  // Carga inicial (cabecera + últimos mensajes). Sin rol en el link (r): se prueba el otro lado si el primero no es parte.
  useEffect(() => {
    if (!token) { setError(K.notFound); return; }
    let live = true;
    (async () => {
      const first: ChatRole = r === 's' ? 'seller' : r === 'b' ? 'buyer' : auth.isAuthenticated ? 'seller' : 'buyer';
      const tries: ChatRole[] = r ? [first] : [first, first === 'seller' ? 'buyer' : 'seller'];
      for (const as of tries) {
        try {
          const d = await readChat(auth, as, String(token), { full: true });
          if (!live) return;
          setRole(d.role); setConv(d.conversation ?? null); setMsgs(d.messages); setCanBlock(d.can_block !== false); addProducts(d.products);
          setState({ blocked: d.blocked, other_read_at: d.other_read_at, other_typing: d.other_typing, has_more: d.has_more });
          track('chat_opened', { role: d.role, kind: d.conversation?.kind ?? 'store', source: typeof src === 'string' && /^[a-z_]{2,20}$/.test(src) ? src : 'link', messages: d.messages.length });
          void refreshUnread(auth, d.role);
          return;
        } catch (e: any) {
          if (!live) return;
          if (e?.status === 404 && as !== tries[tries.length - 1]) continue;
          setError(e?.code === 'chat_unavailable' ? K.unavailable : e?.status === 404 ? K.notFound : K.loadError);
          return;
        }
      }
    })();
    return () => { live = false; };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Polling inteligente: solo lo nuevo (after=<último id>), rápido con actividad, detenido con la pestaña oculta.
  const poll = useCallback(async () => {
    if (!token || !conv) return;
    const after = msgsRef.current.reduce((m, x) => (x.id > m ? x.id : m), 0);
    try {
      const d = await readChat(auth, roleRef.current, String(token), { after, typing: Date.now() - lastTyped.current < 4000 });
      if (d.messages.length) { lastActivity.current = Date.now(); addProducts(d.products); setMsgs((cur) => mergeMessages(cur, d.messages)); }
      setState((s) => (s.blocked === d.blocked && s.other_read_at === d.other_read_at && s.other_typing === d.other_typing ? s : { ...s, blocked: d.blocked, other_read_at: d.other_read_at, other_typing: d.other_typing }));
    } catch { /* sin red: siguiente ciclo */ }
  }, [token, conv]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!conv) return;
    let timer: ReturnType<typeof setTimeout> | null = null, stopped = false;
    const visible = () => Platform.OS !== 'web' || typeof document === 'undefined' || !document.hidden;
    const schedule = () => {
      if (stopped) return;
      const d = chatPollDelay({ visible: visible(), idleMs: Date.now() - lastActivity.current });
      if (d == null) return; // pestaña oculta: se reanuda con visibilitychange
      timer = setTimeout(async () => { await poll(); schedule(); }, d);
    };
    const onVis = () => { if (!visible()) return; if (timer) clearTimeout(timer); void poll().then(schedule); };
    schedule();
    if (Platform.OS === 'web' && typeof document !== 'undefined') { document.addEventListener('visibilitychange', onVis); window.addEventListener('focus', onVis); }
    return () => { stopped = true; if (timer) clearTimeout(timer); if (Platform.OS === 'web' && typeof document !== 'undefined') { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); } };
  }, [conv, poll]);

  // Siempre al último mensaje si ya estabas abajo (no te mueve si estás leyendo más arriba).
  useEffect(() => { if (nearBottom.current) requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: msgs.length > 0 })); }, [msgs.length, state.other_typing]);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    nearBottom.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 80;
  };

  const deliver = useCallback(async (m: ChatMsg) => {
    try {
      const { message } = await sendChat(auth, roleRef.current, String(token), m.body, m.client_id!, m.item_slug);
      if (m.item_slug && !message.item_slug) noMarkers.current = true;
      setMsgs((cur) => mergeMessages(cur, [message]));
    } catch (e: any) {
      setMsgs((cur) => cur.map((x) => (x.client_id === m.client_id ? { ...x, pending: 'failed' } : x)));
      if (e?.code === 'chat_blocked') setState((s) => ({ ...s, blocked: true }));
      if (e?.status === 429 || e?.status === 400 || e?.status === 403) toast(e.message, 'info');
      haptic.error();
    }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = (body: string, quick?: number) => {
    const t = body.trim();
    if (!t || !conv || state.blocked) return;
    if ([...t].length > CHAT_MAX) { toast(`El mensaje puede tener hasta ${CHAT_MAX} caracteres.`, 'info'); return; }
    haptic.tap();
    // Tarjeta del producto: el primer mensaje del comprador por el producto con el que abrió (el servidor lo vuelve a decidir).
    const want = role === 'buyer' && typeof fromItem === 'string' && conv.kind === 'store' && conv.item?.slug === fromItem ? fromItem : null;
    const lastCard = [...msgs].reverse().find((x) => x.item_slug)?.item_slug ?? null;
    const item_slug = want && !noMarkers.current && lastCard !== want ? want : null;
    const m: ChatMsg = { id: -Date.now(), sender: role, body: t, client_id: newClientId(), created_at: new Date().toISOString(), pending: 'sending', item_slug };
    nearBottom.current = true; lastActivity.current = Date.now(); lastTyped.current = 0;
    setMsgs((cur) => [...cur, m]);
    if (quick == null) setText('');
    track('chat_message_sent', { role, kind: conv.kind, quick: quick != null, length: lenBucket(t.length), contact: sharesContact(t) });
    if (quick != null) track('chat_quick_reply', { reply: K.quickKeys[quick] ?? 'otro', role, kind: conv.kind });
    void deliver(m);
  };
  const retry = (m: ChatMsg) => { haptic.tap(); setMsgs((cur) => cur.map((x) => (x.client_id === m.client_id ? { ...x, pending: 'sending' } : x))); void deliver({ ...m, pending: 'sending' }); };

  const loadOlder = async () => {
    const first = msgs.find((m) => m.id > 0);
    if (!first) return;
    try {
      const d = await readChat(auth, role, String(token), { before: first.id });
      nearBottom.current = false;
      addProducts(d.products); setMsgs((cur) => mergeMessages(cur, d.messages)); setState((s) => ({ ...s, has_more: d.has_more }));
    } catch { toast(K.loadError, 'info'); }
  };

  const toggleBlock = async () => {
    setMenu(false);
    try { const r0 = await blockChat(auth, String(token), !state.blocked); setState((s) => ({ ...s, blocked: r0.blocked })); toast(r0.blocked ? K.blockedToast : K.unblockedToast); track('chat_blocked', { blocked: r0.blocked }); }
    catch (e: any) { if (e?.code === 'chat_block_locked') setCanBlock(false); toast(e?.message ?? K.loadError, 'info'); }
  };

  const mineLastRead = state.other_read_at ? Date.parse(state.other_read_at) : 0;
  const buyerSent = msgs.filter((m) => m.sender === 'buyer').length;
  const showQuick = role === 'buyer' && !!conv && !conv.paid && !state.blocked && !text && buyerSent < 3;
  const rows = useMemo(() => {
    const out: ({ k: 'day'; label: string; key: string } | { k: 'item'; slug: string; mine: boolean; key: string } | { k: 'msg'; m: ChatMsg; first: boolean; last: boolean; key: string })[] = [];
    let day = '';
    const idx = new Map(msgs.map((m, i) => [m, i]));
    itemCardRows(msgs).forEach((row) => {
      const m = row.m, i = idx.get(m) ?? 0;
      const d = dayLabel(m.created_at);
      if (d !== day) { day = d; out.push({ k: 'day', label: d, key: `d-${d}-${i}` }); }
      if (row.k === 'item') { out.push({ k: 'item', slug: row.slug, mine: row.sender === role, key: row.key }); return; }
      const prev = msgs[i - 1], next = msgs[i + 1];
      const same = (a?: ChatMsg) => !!a && a.sender === m.sender && dayLabel(a.created_at) === d && Math.abs(Date.parse(a.created_at) - Date.parse(m.created_at)) < 5 * 60_000;
      out.push({ k: 'msg', m, first: !!m.item_slug || !same(prev), last: !same(next) || !!next?.item_slug, key: m.client_id ?? String(m.id) });
    });
    return out;
  }, [msgs, role]);
  // Datos de la tarjeta: los que manda el servidor, o (envío optimista) los del tema de la conversación.
  const productOf = (slug: string): ChatProduct | null => products[slug]
    ?? (conv?.item?.slug === slug ? { slug, title: conv.subject ?? K.seeItem, photo: conv.item_photo, price_crc: conv.item.price_crc, available: true } : null);

  if (error) return (
    <View style={st.screen}>
      <SpaceBackground mode="calm" />
      <View style={[s.wrap, { paddingTop: insets.top + S.md }]}>
        <TopBar onBack={() => goBack(fallback)} />
        <View style={s.center}><Icon name="chatbubbles-outline" size={48} color={C.lilac} /><Text style={[T.callout, { textAlign: 'center' }]} testID="chat-error">{error}</Text></View>
      </View>
    </View>
  );

  const other = conv?.other;
  const sub = !conv ? '' : conv.kind === 'order' ? `${K.order}${conv.order ? ` · ${STATUS_LABEL[conv.order.status] ?? conv.order.status}` : ''}` : conv.subject ? `${K.about}: ${conv.subject}` : other?.store_slug ? `@${other.store_slug}` : '';
  const ctxSlug = conv?.order?.slug ?? conv?.item?.slug ?? null;
  const count = [...text].length;

  return (
    <View style={st.screen}>
      <SpaceBackground mode="calm" />
      <View style={[s.wrap, { paddingTop: insets.top + S.sm }]}>
        <TopBar onBack={() => goBack(fallback)} right={conv ? <IconButton icon="ellipsis-horizontal" label={K.options} onPress={() => setMenu(true)} /> : null}>
          {conv && other ? <View style={s.who}>
            <Avatar name={other.name} url={other.avatar_url} size={36} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={T.headline} numberOfLines={1} testID="chat-title">{other.name}</Text>
              {state.other_typing ? <Text style={[T.footnote, { color: C.success }]} numberOfLines={1}>{K.typing}</Text>
                : sub ? <Text style={T.footnote} numberOfLines={1}>{sub}</Text> : null}
            </View>
          </View> : <View style={[s.who, { gap: S.sm }]}><Skeleton w={36} h={36} r={18} /><Skeleton w={140} h={18} /></View>}
        </TopBar>

        {conv && conv.kind === 'store' && conv.item_gone ? (
          <View style={s.ctx} testID="chat-context-gone" accessibilityRole="text">
            <View style={[s.ctxImg, s.center0]}><Icon name="pricetag-outline" size={18} color={C.textDim} /></View>
            <Text style={[T.footnote, { flex: 1 }]} numberOfLines={2}>{K.itemGone}</Text>
          </View>
        ) : conv && (conv.subject || conv.order) && ctxSlug ? (
          <Pressable accessibilityRole="link" accessibilityLabel={`${conv.kind === 'order' ? K.seeOrder : K.seeItem}: ${conv.subject ?? ''}`} testID="chat-context"
            onPress={() => { haptic.tap(); router.push({ pathname: '/p/[slug]', params: { slug: ctxSlug } }); }}
            style={({ pressed }) => [s.ctx, pressTransition, pressed && { opacity: 0.85 }]}>
            {conv.item_photo ? <Image source={{ uri: conv.item_photo }} style={s.ctxImg} accessibilityIgnoresInvertColors />
              : <View style={[s.ctxImg, s.center0]}><Icon name={conv.kind === 'order' ? 'bag-check-outline' : 'pricetag-outline'} size={18} color={C.lilac} /></View>}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[T.body, { fontSize: 14 }]} numberOfLines={1}>{conv.subject ?? K.order}</Text>
              {(conv.order?.price_crc ?? conv.item?.price_crc) != null ? <Text style={[T.footnote, { color: C.text, fontFamily: Fonts.bold }]}>{formatCRC((conv.order?.price_crc ?? conv.item?.price_crc)!)}</Text> : null}
            </View>
            <Text style={[T.footnote, { color: C.lilac, fontFamily: Fonts.bold }]}>{K.see}</Text>
            <Icon name="chevron-forward" size={16} color={C.lilac} />
          </Pressable>
        ) : null}

        <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={s.list} onScroll={onScroll} scrollEventThrottle={64}
          keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} testID="chat-messages"
          onContentSizeChange={() => { if (nearBottom.current) scroll.current?.scrollToEnd({ animated: false }); }}>
          {!conv ? <><Skeleton w="60%" h={40} r={18} /><Skeleton w="45%" h={40} r={18} style={{ alignSelf: 'flex-end' }} /></> : null}
          {/* Antes de pagar, el aviso queda siempre a la vista en la conversación (no solo vacía o con un teléfono/link). */}
          {conv && !conv.paid && msgs.length > 0 ? <PayInside pinned /> : null}
          {conv && state.has_more ? <PrimaryButton title={K.older} variant="ghost" icon="chevron-up" onPress={loadOlder} /> : null}
          {conv && msgs.length === 0 ? (
            <View style={s.empty} testID="chat-empty">
              <View style={s.emptyIcon}><Icon name="chatbubbles-outline" size={28} color={C.purpleDark} /></View>
              <Text style={[T.callout, { textAlign: 'center' }]}>{role === 'buyer' ? K.first(other?.name ?? 'el vendedor') : K.firstSeller}</Text>
              {!conv.paid ? <PayInside /> : null}
            </View>
          ) : null}
          {rows.map((row) => row.k === 'day'
            ? <View key={row.key} style={s.day}><Text style={s.dayText}>{row.label}</Text></View>
            : row.k === 'item' ? <ItemCard key={row.key} p={productOf(row.slug)} slug={row.slug} mine={row.mine} />
            : <Bubble key={row.key} m={row.m} mine={row.m.sender === role} first={row.first} last={row.last}
                read={row.m.id > 0 && mineLastRead >= Date.parse(row.m.created_at)} notice={!conv?.paid && sharesContact(row.m.body)} onRetry={retry} />)}
          {state.other_typing ? <TypingBubble /> : null}
        </ScrollView>

        {showQuick ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={s.quick} accessibilityLabel={K.quickA11y} testID="chat-quick">
            {K.quick.map((q, i) => (
              <Pressable key={q} accessibilityRole="button" onPress={() => send(q, i)} style={({ pressed }) => [s.chip, pressTransition, pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] }]}>
                <Text style={s.chipText}>{q}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        <View style={[s.composer, { paddingBottom: Math.max(insets.bottom, S.sm) }]} testID="chat-composer">
          {state.blocked ? (
            <View style={s.blocked}>
              <Icon name="ban-outline" size={18} color={C.textDim} />
              <Text style={[T.footnote, { flex: 1 }]}>{role === 'seller' ? K.blockedSeller : K.blockedBuyer}</Text>
              {role === 'seller' ? <Pressable accessibilityRole="button" onPress={toggleBlock} hitSlop={8}><Text style={[T.footnote, { color: C.lilac, fontFamily: Fonts.bold }]}>{K.unblock}</Text></Pressable> : null}
            </View>
          ) : <>
            <View style={s.inputWrap}>
              <TextInput value={text} onChangeText={(v) => { setText(v); lastTyped.current = Date.now(); lastActivity.current = Date.now(); }}
                placeholder={K.placeholder} placeholderTextColor={C.textDim} accessibilityLabel={K.inputA11y} multiline maxLength={CHAT_MAX + 50}
                editable={!!conv} style={s.input} testID="chat-input" enterKeyHint="send" submitBehavior="newline"
                onKeyPress={(e: any) => { if (Platform.OS === 'web' && e.nativeEvent?.key === 'Enter' && !e.nativeEvent?.shiftKey && !(globalThis as any).navigator?.maxTouchPoints) { e.preventDefault?.(); send(text); } }} />
              {count > CHAT_MAX - 100 ? <Text style={[s.counter, count > CHAT_MAX && { color: C.orange }]}>{K.count(count, CHAT_MAX)}</Text> : null}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={K.sendBtn} disabled={!text.trim() || !conv} onPress={() => send(text)} testID="chat-send"
              style={({ pressed }) => [s.sendBtn, (!text.trim() || !conv) && { opacity: 0.4 }, pressTransition, pressed && { transform: [{ scale: 0.92 }] }]}>
              <Icon name="arrow-up" size={22} color={C.purple} />
            </Pressable>
          </>}
        </View>
      </View>

      <Sheet visible={menu} onClose={() => setMenu(false)} title={K.options}>
        {ctxSlug ? <ListRow icon={conv?.kind === 'order' ? 'bag-check-outline' : 'pricetag-outline'} title={conv?.kind === 'order' ? K.seeOrder : K.seeItem} onPress={() => { setMenu(false); router.push({ pathname: '/p/[slug]', params: { slug: ctxSlug } }); }} /> : null}
        {role === 'buyer' && other?.store_slug ? <ListRow icon="storefront-outline" title={COPY.ficha.seeProfile} onPress={() => { setMenu(false); router.push({ pathname: '/t/[store]', params: { store: other.store_slug! } }); }} /> : null}
        <ListRow icon="flag-outline" title={K.report} onPress={() => { setMenu(false); setReport(true); }} />
        {role === 'seller' && (state.blocked || canBlock) ? <ListRow icon={state.blocked ? 'lock-open-outline' : 'ban-outline'} title={state.blocked ? K.unblock : K.block} onPress={toggleBlock} /> : null}
        {/* Compra en curso o disputa abierta entre los dos: no se puede bloquear (el comprador siempre puede escribir y disputar). */}
        {role === 'seller' && !state.blocked && !canBlock ? (
          <View style={s.locked} testID="chat-block-locked" accessibilityRole="text" aria-disabled>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, opacity: 0.55 }}><View style={st.rowIcon}><Icon name="ban-outline" size={20} color={C.lilac} /></View><Text style={T.headline}>{K.block}</Text></View>
            <Text style={T.footnote}>{K.blockLocked}</Text>
          </View>
        ) : null}
      </Sheet>
      <ReportSheet visible={report} onClose={() => setReport(false)} onSend={async (reason, detail) => {
        await reportChat(auth, role, String(token), reason, detail); setReport(false); toast(K.reported); track('chat_reported', { reason, role });
      }} />
    </View>
  );
}

function TopBar({ onBack, right, children }: { onBack: () => void; right?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <View style={s.top}>
      <Pressable accessibilityRole="button" accessibilityLabel="Volver" hitSlop={6} onPress={() => { haptic.tap(); onBack(); }} testID="back-button"
        style={({ pressed }) => [s.back, pressTransition, pressed && { opacity: 0.8 }]}>
        <Icon name="chevron-back" size={24} color={C.lilac} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
      {right}
    </View>
  );
}

function Avatar({ name, url, size }: { name: string; url: string | null; size: number }) {
  const round = { width: size, height: size, borderRadius: size / 2 };
  return url ? <Image source={{ uri: url }} style={[round, { backgroundColor: C.lilacBg }]} accessibilityIgnoresInvertColors />
    : <View style={[round, s.center0, { backgroundColor: C.lilac }]}><Text style={{ fontFamily: Fonts.black, fontSize: size / 2.3, color: C.purpleDark }}>{name.replace(/^Comprador · /, '').charAt(0).toUpperCase()}</Text></View>;
}

function PayInside({ pinned }: { pinned?: boolean }) {
  return <View style={[s.notice, pinned && { alignSelf: 'center', marginBottom: S.xs }]} testID={pinned ? 'chat-pay-pinned' : 'chat-pay-inside'}><Icon name="lock-closed" size={13} color={C.lilac} /><Text style={[T.footnote, { flexShrink: 1 }]}>{K.payInside}</Text></View>;
}

function Bubble({ m, mine, first, last, read, notice, onRetry }: { m: ChatMsg; mine: boolean; first: boolean; last: boolean; read: boolean; notice: boolean; onRetry: (m: ChatMsg) => void }) {
  const status: { icon: IconName; color: string; label: string } | null = !mine ? null
    : m.pending === 'sending' ? { icon: 'time-outline', color: 'rgba(26,11,61,0.55)', label: K.sending }
    : m.pending === 'failed' ? { icon: 'alert-circle', color: C.orange, label: K.failed }
    : read ? { icon: 'checkmark-done', color: C.purple, label: K.read } : { icon: 'checkmark', color: 'rgba(26,11,61,0.55)', label: K.sent };
  const body = (
    <View {...(m.pending === 'sending' || m.id > 0 ? anim('msg') : {})} style={[s.bubble, mine ? s.mine : s.theirs,
      mine ? { borderTopRightRadius: first ? 20 : 6, borderBottomRightRadius: last ? 20 : 6 } : { borderTopLeftRadius: first ? 20 : 6, borderBottomLeftRadius: last ? 20 : 6 },
      m.pending === 'failed' && { opacity: 0.75 }]}
      accessibilityLabel={`${mine ? 'Tú' : 'Mensaje'}: ${m.body}. ${hhmm(m.created_at)}${status ? `. ${status.label}` : ''}`} testID={mine ? 'bubble-mine' : 'bubble-theirs'}>
      <Text style={[s.msgText, mine && { color: C.purpleDark }]} selectable>{m.body}</Text>
      <View style={s.meta}>
        <Text style={[s.time, mine && { color: 'rgba(26,11,61,0.55)' }]}>{hhmm(m.created_at)}</Text>
        {status ? <Icon name={status.icon} size={14} color={status.color} /> : null}
      </View>
    </View>
  );
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginTop: first ? S.sm : 2, gap: 4 }}>
      {m.pending === 'failed' ? <Pressable accessibilityRole="button" accessibilityLabel={K.failed} onPress={() => onRetry(m)} style={{ maxWidth: '82%' }}>{body}<Text style={[T.footnote, { color: C.orange, textAlign: 'right' }]}>{K.failed}</Text></Pressable>
        : <View style={{ maxWidth: '82%' }}>{body}</View>}
      {notice ? <PayInside /> : null}
    </View>
  );
}

/** Tarjeta del producto en el hilo (estilo Messenger): foto, título y precio; tocar abre la ficha /p/<slug>. */
function ItemCard({ p, slug, mine }: { p: ChatProduct | null; slug: string; mine: boolean }) {
  if (p && p.available === false) return ( // borrado o archivado: la conversación sigue; la tarjeta lo dice, sin link
    <View testID="chat-item-gone" accessibilityRole="text" style={[s.itemCard, { alignSelf: mine ? 'flex-end' : 'flex-start', borderColor: C.line }]}>
      <View style={[s.itemImg, s.center0]}><Icon name="pricetag-outline" size={22} color={C.textDim} /></View>
      <Text style={[T.callout, { flex: 1 }]} numberOfLines={2}>{K.itemGone}</Text>
    </View>
  );
  const title = p?.title ?? K.seeItem;
  const price = p?.price_crc != null ? formatCRC(p.price_crc) : null;
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`${K.seeItem}: ${title}${price ? `, ${price}` : ''}`} testID="chat-item-card" {...anim('msg')}
      onPress={() => { haptic.tap(); track('chat_item_opened', { from: mine ? 'mine' : 'theirs' }); router.push({ pathname: '/p/[slug]', params: { slug } }); }}
      style={({ pressed }) => [s.itemCard, { alignSelf: mine ? 'flex-end' : 'flex-start' }, pressTransition, pressed && { opacity: 0.85 }]}>
      {p?.photo ? <Image source={{ uri: p.photo }} style={s.itemImg} accessibilityIgnoresInvertColors />
        : <View style={[s.itemImg, s.center0]}><Icon name="pricetag-outline" size={22} color={C.lilac} /></View>}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={[T.body, { fontSize: 15, fontFamily: Fonts.bold }]} numberOfLines={2}>{title}</Text>
        {price ? <Text style={[T.footnote, { color: C.text, fontFamily: Fonts.bold }]}>{price}</Text> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Text style={[T.footnote, { color: C.lilac, fontFamily: Fonts.bold }]}>{K.seeItem}</Text>
          <Icon name="chevron-forward" size={14} color={C.lilac} />
        </View>
      </View>
    </Pressable>
  );
}

function TypingBubble() {
  return (
    <View style={[s.bubble, s.theirs, s.typing]} accessibilityLabel={K.typing} testID="chat-typing">
      {[0, 1, 2].map((i) => <View key={i} {...anim('dot')} style={s.dot} />)}
    </View>
  );
}

function ReportSheet({ visible, onClose, onSend }: { visible: boolean; onClose: () => void; onSend: (reason: string, detail: string) => Promise<void> }) {
  const [reason, setReason] = useState('spam');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Sheet visible={visible} onClose={onClose} title={K.reportTitle}
      footer={<PrimaryButton title={K.reportSend} icon="flag" loading={busy} onPress={async () => { setBusy(true); setErr(null); try { await onSend(reason, detail); setDetail(''); } catch (e: any) { setErr(e?.message ?? K.loadError); } finally { setBusy(false); } }} />}>
      <Text style={T.callout}>{K.reportText}</Text>
      <View accessibilityRole="radiogroup" style={{ gap: S.xs }}>
        {K.reasons.map(([k, label]) => (
          <Pressable key={k} accessibilityRole="radio" accessibilityState={{ checked: reason === k }} aria-checked={reason === k} onPress={() => { haptic.tap(); setReason(k); }}
            style={({ pressed }) => [s.reason, reason === k && s.reasonOn, pressed && { opacity: 0.85 }]}>
            <Icon name={reason === k ? 'radio-button-on' : 'radio-button-off'} size={20} color={reason === k ? C.lilac : C.textDim} />
            <Text style={T.body}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput value={detail} onChangeText={setDetail} placeholder={K.reportDetail} placeholderTextColor={C.textDim} accessibilityLabel={K.reportDetail} maxLength={280} multiline style={[s.input, s.reportInput]} />
      {err ? <Text style={[T.footnote, { color: C.orange }]}>{err}</Text> : null}
    </Sheet>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: S.md, padding: S.lg },
  center0: { alignItems: 'center', justifyContent: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', gap: S.xs, paddingHorizontal: S.sm, paddingBottom: S.sm, minHeight: TOUCH + S.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  back: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: 'center', justifyContent: 'center' },
  who: { flexDirection: 'row', alignItems: 'center', gap: S.sm + 2, minWidth: 0 },
  ctx: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginHorizontal: S.md, marginTop: S.sm, padding: S.sm, borderRadius: R.md, backgroundColor: C.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  ctxImg: { width: 40, height: 40, borderRadius: 10, backgroundColor: C.lilacBg },
  itemCard: { flexDirection: 'row', alignItems: 'center', gap: S.sm + 2, width: '78%', maxWidth: 340, marginTop: S.md, padding: S.sm, borderRadius: 18, backgroundColor: C.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(201,182,255,0.45)' },
  itemImg: { width: 64, height: 64, borderRadius: 12, backgroundColor: C.lilacBg },
  list: { paddingHorizontal: S.md, paddingTop: S.sm, paddingBottom: S.md, gap: 0, flexGrow: 1, justifyContent: 'flex-end' },
  empty: { alignItems: 'center', gap: S.sm, paddingVertical: S.xl, paddingHorizontal: S.md, marginBottom: 'auto', marginTop: 'auto' },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.lilac, alignItems: 'center', justifyContent: 'center' },
  day: { alignSelf: 'center', marginVertical: S.sm, paddingHorizontal: S.sm + 2, paddingVertical: 3, borderRadius: R.pill, backgroundColor: 'rgba(201,182,255,0.10)' },
  dayText: { fontFamily: Fonts.bold, fontSize: 12, color: C.textDim },
  bubble: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, borderRadius: 20, gap: 2 },
  mine: { backgroundColor: C.lilac },
  theirs: { backgroundColor: C.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  msgText: { fontFamily: Fonts.regular, fontSize: 16, lineHeight: 22, color: C.text, ...(Platform.OS === 'web' ? { overflowWrap: 'anywhere', wordBreak: 'break-word' } as object : {}) },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-end' },
  time: { fontFamily: Fonts.regular, fontSize: 11, color: C.textDim, fontVariant: ['tabular-nums'] },
  typing: { flexDirection: 'row', gap: 4, alignSelf: 'flex-start', paddingVertical: 12, marginTop: S.sm },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.lilac },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: R.md, backgroundColor: 'rgba(201,182,255,0.10)', maxWidth: '92%' },
  quick: { gap: S.sm, paddingHorizontal: S.md, paddingVertical: S.sm },
  chip: { minHeight: 40, paddingHorizontal: 14, borderRadius: R.pill, borderWidth: 1, borderColor: 'rgba(201,182,255,0.45)', backgroundColor: 'rgba(201,182,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  chipText: { fontFamily: Fonts.bold, fontSize: 15, color: C.lilac },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: S.sm, paddingHorizontal: S.md, paddingTop: S.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, backgroundColor: C.bg },
  inputWrap: { flex: 1, minWidth: 0, backgroundColor: C.surface2, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  input: { minHeight: TOUCH, maxHeight: 132, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, color: C.text, fontFamily: Fonts.regular, fontSize: 16, lineHeight: 22, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as object : {}) },
  counter: { position: 'absolute', right: 12, top: -18, fontFamily: Fonts.bold, fontSize: 11, color: C.textDim },
  sendBtn: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, backgroundColor: C.white, alignItems: 'center', justifyContent: 'center' },
  blocked: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: S.sm, minHeight: TOUCH },
  reason: { flexDirection: 'row', alignItems: 'center', gap: S.sm, minHeight: TOUCH, paddingHorizontal: S.sm, borderRadius: R.sm + 4 },
  reasonOn: { backgroundColor: C.lilacBg },
  locked: { gap: 4, paddingVertical: S.sm, minHeight: TOUCH },
  reportInput: { backgroundColor: C.surface2, borderRadius: R.md, minHeight: 72, textAlignVertical: 'top' },
});
