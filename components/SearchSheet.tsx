// Hoja del buscador de Comprar (se abre con la lupa de ComprarNav): input enfocado (>= 16 px, sin zoom en iPhone),
// limpiar, y cerrar con la X, tocando afuera o Esc (Sheet). Enter cierra y deja ver los resultados en el feed.
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon, PrimaryButton, Sheet } from '@/components/ds';
import { Fonts } from '@/constants/Colors';
import { C, R, S, T, TOUCH } from '@/constants/theme';
import { COPY } from '@/lib/copy';
import { clearSearch, closeSearch, SEARCH_COPY, setSearchText, useFeedSearch } from '@/lib/feedSearch';

export function SearchSheet() {
  const { open, text } = useFeedSearch();
  return (
    <Sheet visible={open} onClose={closeSearch} title={SEARCH_COPY.title}
      footer={<PrimaryButton title={SEARCH_COPY.submit} icon="search" onPress={closeSearch} testID="search-submit" />}>
      <View style={s.box}>
        <Icon name="search" size={20} color={C.textDim} />
        <TextInput style={s.input} value={text} onChangeText={setSearchText} placeholder={COPY.feed.searchPlaceholder} placeholderTextColor={C.textDim}
          accessibilityLabel={COPY.feed.searchLabel} autoFocus autoCapitalize="none" autoCorrect={false} returnKeyType="search" enterKeyHint="search" maxLength={60}
          onSubmitEditing={() => closeSearch()} testID="search-input" />
        {text ? <Pressable onPress={() => clearSearch()} accessibilityRole="button" accessibilityLabel={COPY.feed.clear} hitSlop={10} style={s.clear}>
          <Icon name="close-circle" size={20} color={C.textDim} /></Pressable> : null}
      </View>
      <Text style={T.footnote}>{SEARCH_COPY.hint}</Text>
    </Sheet>
  );
}

const s = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: S.sm, backgroundColor: C.surface, borderRadius: R.md, paddingLeft: S.md, minHeight: TOUCH + 4, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  input: { flex: 1, minWidth: 0, color: C.text, fontFamily: Fonts.regular, fontSize: 16, minHeight: TOUCH + 4, paddingVertical: 0, outlineStyle: 'none' } as any,
  clear: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
});
