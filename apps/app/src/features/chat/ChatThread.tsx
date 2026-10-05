import type { MessageDto } from '@farmgo/contracts';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMarkRead } from '../../data/conversations';
import { statusView, useMessages, useOrder, useSendMessage } from '../../data/orders';
import { joinChannel } from '../../data/realtime';
import { useSession } from '../../data/session';
import { pickPhoto, uploadPhoto } from '../../features/qa/upload';
import { humanError } from '../../lib/errors';
import { relativeDay, timeShort } from '../../lib/format';
import { useTheme } from '../../theme/theme';
import { IconButton } from '../../ui/Button';
import { Pill } from '../../ui/Controls';
import { useToast } from '../../ui/overlays/Toast';
import { Pressable } from '../../ui/Pressable';
import { Header } from '../../ui/Screen';
import { SkeletonList } from '../../ui/Skeleton';
import { EmptyState, ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';

type Row =
  | { kind: 'day'; id: string; label: string }
  | { kind: 'msg'; id: string; m: MessageDto; mine: boolean; tail: boolean };

/** Order chat between buyer and farmer (support staff can join). `embedded` drops the back header for the Messages split view. */
export function ChatThread({ orderId, embedded }: { orderId: string; embedded?: boolean }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const me = useSession((s) => s.me);
  const order = useOrder(orderId);
  const messages = useMessages(orderId);
  const send = useSendMessage(orderId);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<{ key: string; uri: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [focused, setFocused] = useState(false);
  const input = useRef<TextInput>(null);

  useEffect(() => joinChannel(`order:${orderId}`), [orderId]);
  const markRead = useMarkRead(orderId);
  const count = messages.data?.length ?? 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: mark read when a thread opens or grows, not when the mutation object changes
  useEffect(() => {
    if (count > 0) markRead.mutate();
  }, [orderId, count]);

  // Newest at the bottom: the list is inverted, so rows run newest first.
  const rows = useMemo<Row[]>(() => {
    const list = messages.data ?? [];
    const out: Row[] = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i]!;
      const next = list[i + 1];
      const prev = list[i - 1];
      const mine = m.authorId === me?.user.id;
      out.push({ kind: 'msg', id: m.id, m, mine, tail: !next || next.authorId !== m.authorId });
      const day = relativeDay(m.createdAt);
      if (!prev || relativeDay(prev.createdAt) !== day)
        out.push({ kind: 'day', id: `d-${m.id}`, label: day });
    }
    return out;
  }, [messages.data, me?.user.id]);

  const o = order.data;
  const other = o ? (o.viewer === 'farmer' || o.viewer === 'agent' ? o.buyerOrg.name : o.farmer.name) : '';
  const canSend = text.trim().length > 0 && !uploading && !send.isPending;

  const attach = async () => {
    const picked = await pickPhoto('library');
    if (picked === null) return;
    if (picked === 'denied') return toast.error(tr('qa.galleryDenied'));
    setUploading(true);
    try {
      const key = await uploadPhoto('chat', picked);
      setPhotos((p) => [...p, { key, uri: picked.uri }]);
      input.current?.focus();
    } catch (err) {
      toast.error(humanError(err));
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!canSend) return;
    const body = text.trim();
    const keys = photos.map((p) => p.key);
    setText('');
    setPhotos([]);
    try {
      await send.mutateAsync({ body, photos: keys });
    } catch (err) {
      setText(body);
      toast.error(humanError(err), { label: tr('common.retry'), onPress: () => void submit() });
    }
  };

  const status = o ? statusView(o.status, o.viewer) : null;

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Header
        back={!embedded}
        title={other || tr('chat.title')}
        subtitle={o?.code}
        right={
          o ? (
            <Pressable
              onPress={() => router.push({ pathname: '/order/[id]', params: { id: o.id } })}
              accessibilityLabel={tr('chat.openOrder')}
              focusRadius={999}
            >
              {status && <Pill label={tr(status.labelKey)} tone={status.tone} size="sm" />}
            </Pressable>
          ) : undefined
        }
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' }}>
          {messages.isLoading ? (
            <View style={{ padding: 20 }}>
              <SkeletonList count={4} height={52} />
            </View>
          ) : messages.error ? (
            <ErrorState onRetry={() => messages.refetch()} message={humanError(messages.error)} />
          ) : rows.length === 0 ? (
            <EmptyState
              art="noMessages"
              title={tr('chat.emptyTitle', { name: other })}
              body={tr('chat.emptyBody')}
            />
          ) : (
            <FlatList
              inverted
              data={rows}
              keyExtractor={(r) => r.id}
              contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }}
              keyboardDismissMode="interactive"
              renderItem={({ item }) =>
                item.kind === 'day' ? (
                  <Text variant="caption" tone="tertiary" align="center" style={{ marginVertical: 12 }}>
                    {item.label}
                  </Text>
                ) : (
                  <Bubble m={item.m} mine={item.mine} tail={item.tail} />
                )
              }
            />
          )}

          {photos.length > 0 && (
            <View style={styles.previews}>
              {photos.map((p) => (
                <View key={p.key}>
                  <Image
                    source={{ uri: p.uri }}
                    style={[styles.preview, { borderRadius: t.radius.sm }]}
                    contentFit="cover"
                  />
                  <IconButton
                    icon="close"
                    label={tr('chat.removePhoto')}
                    size={24}
                    iconSize={14}
                    variant="onPhoto"
                    onPress={() => setPhotos((all) => all.filter((x) => x.key !== p.key))}
                    style={{ position: 'absolute', top: -14, right: -14 }}
                  />
                </View>
              ))}
            </View>
          )}

          <View
            style={[
              styles.composer,
              {
                paddingBottom: (embedded ? 0 : insets.bottom) + 10,
                borderTopColor: t.colors.line,
                backgroundColor: t.colors.bg,
              },
            ]}
          >
            {uploading ? (
              <View style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color={t.colors.primary} />
              </View>
            ) : (
              <IconButton
                icon="image"
                label={tr('chat.attach')}
                onPress={attach}
                disabled={photos.length >= 4}
              />
            )}
            <TextInput
              ref={input}
              value={text}
              onChangeText={setText}
              placeholder={tr('chat.placeholder')}
              placeholderTextColor={t.colors.textTertiary}
              multiline
              maxLength={2000}
              accessibilityLabel={tr('chat.placeholder')}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyPress={(e) => {
                const ne = e.nativeEvent as { key: string; shiftKey?: boolean };
                if (Platform.OS === 'web' && ne.key === 'Enter' && !ne.shiftKey) {
                  (e as unknown as { preventDefault: () => void }).preventDefault();
                  void submit();
                }
              }}
              style={[
                styles.input,
                {
                  backgroundColor: t.colors.surface,
                  borderColor: focused ? t.colors.primary : t.colors.line,
                  color: t.colors.text,
                  borderRadius: 22,
                  fontFamily: t.fonts.regular,
                },
                Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as object) : null,
              ]}
            />
            <IconButton
              icon="send"
              label={tr('chat.send')}
              variant={canSend ? 'tinted' : 'plain'}
              color={canSend ? t.colors.primary : t.colors.textTertiary}
              disabled={!canSend}
              onPress={submit}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function Bubble({ m, mine, tail }: { m: MessageDto; mine: boolean; tail: boolean }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const staff = !mine && m.author.role && !['buyer', 'farmer', 'user', 'agent'].includes(m.author.role);
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginTop: tail ? 10 : 2 }}>
      {!mine && staff && tail && (
        <Text variant="caption" tone="secondary" style={{ marginBottom: 2, marginLeft: 4 }}>
          {m.author.name} · {tr('chat.support')}
        </Text>
      )}
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: mine ? t.colors.primary : t.colors.surface,
            borderColor: mine ? t.colors.primary : t.colors.line,
            borderBottomRightRadius: mine && tail ? 6 : 18,
            borderBottomLeftRadius: !mine && tail ? 6 : 18,
          },
        ]}
      >
        {m.photoUrls.length > 0 && (
          <View style={{ gap: 4, marginBottom: 6 }}>
            {m.photoUrls.map((u) => (
              <Image
                key={u}
                source={{ uri: u }}
                style={{ width: 220, height: 160, borderRadius: 12 }}
                contentFit="cover"
                accessibilityLabel={tr('chat.photo')}
              />
            ))}
          </View>
        )}
        <Text variant="body" style={{ color: mine ? '#FFFFFF' : t.colors.text }} selectable>
          {m.body}
        </Text>
        <Text
          variant="caption"
          style={{
            color: mine ? 'rgba(255,255,255,0.72)' : t.colors.textTertiary,
            alignSelf: 'flex-end',
            marginTop: 2,
          }}
        >
          {timeShort(m.createdAt)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: '82%', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, borderWidth: 1 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    paddingHorizontal: 10,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    minHeight: 44,
    maxHeight: 140,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 16,
  },
  previews: { flexDirection: 'row', gap: 14, paddingHorizontal: 20, paddingTop: 14 },
  preview: { width: 64, height: 64 },
});
