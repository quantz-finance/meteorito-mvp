// Design system de Meteorito: 8pt grid, radios, tipografía y colores derivados de la marca.
import { Platform, type TextStyle } from 'react-native';
import { Brand, Fonts } from './Colors';

export const C = {
  ...Brand,
  bg: Brand.purpleDark,
  surface: Brand.purpleMid,
  surface2: '#3A1D7A',
  line: 'rgba(201,182,255,0.14)',
  text: Brand.white,
  textDim: Brand.muted,
  success: '#3DDC97',
  successBg: 'rgba(61,220,151,0.14)',
  warnBg: 'rgba(255,138,61,0.14)',
  lilacBg: 'rgba(201,182,255,0.14)',
  backdrop: 'rgba(8,3,24,0.6)',
};

/** 8pt grid */
export const S = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 40, xxxl: 48 } as const;
export const R = { sm: 8, md: 16, lg: 24, pill: 999 } as const;
/** Mínimo táctil iOS HIG */
export const TOUCH = 44;
export const BUTTON_H = 56;

const tab: TextStyle = { fontVariant: ['tabular-nums'] };
export const T = {
  largeTitle: { fontFamily: Fonts.black, fontSize: 34, lineHeight: 40, color: C.text } as TextStyle,
  title: { fontFamily: Fonts.black, fontSize: 24, lineHeight: 32, color: C.text } as TextStyle,
  headline: { fontFamily: Fonts.bold, fontSize: 17, lineHeight: 24, color: C.text } as TextStyle,
  body: { fontFamily: Fonts.regular, fontSize: 16, lineHeight: 24, color: C.text } as TextStyle,
  callout: { fontFamily: Fonts.regular, fontSize: 15, lineHeight: 22, color: C.textDim } as TextStyle,
  caption: { fontFamily: Fonts.bold, fontSize: 12, lineHeight: 16, color: C.textDim, letterSpacing: 0.6, textTransform: 'uppercase' } as TextStyle,
  footnote: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 18, color: C.textDim } as TextStyle,
  money: { fontFamily: Fonts.black, fontSize: 40, lineHeight: 48, color: C.text, ...tab } as TextStyle,
  moneySm: { fontFamily: Fonts.black, fontSize: 20, lineHeight: 24, color: C.text, ...tab } as TextStyle,
};

export const shadow = Platform.select({
  web: { boxShadow: '0 12px 32px -12px rgba(0,0,0,0.55)' } as object,
  default: { shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
});
