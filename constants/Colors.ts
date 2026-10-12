export const Brand = {
  purple: '#6C2BD9',
  purpleDark: '#1A0B3D',
  purpleMid: '#2D1466',
  lilac: '#C9B6FF',
  white: '#FFFFFF',
  muted: '#A99BD1',
  orange: '#FF8A3D',
};
export const Fonts = { regular: 'Nunito_400Regular', bold: 'Nunito_700Bold', black: 'Nunito_900Black' };
const theme = { text: Brand.white, background: Brand.purpleDark, tint: Brand.lilac, tabIconDefault: Brand.muted, tabIconSelected: Brand.lilac };
export default { light: theme, dark: theme };
