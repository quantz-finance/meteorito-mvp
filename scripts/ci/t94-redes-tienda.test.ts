// (94) Redes del vendedor en su tienda (031): usuario o link -> link canónico https de cada red; otro esquema, otro
//      dominio o muy largo se rechaza (el API valida igual que la app).
import type { T } from './setup';
import { cleanSocials, normalizeSocial, normalizeSocials } from '../../api/_lib/socials';

export async function run(t: T) {
  t.check('usuario -> link canónico', normalizeSocial('instagram', '@mi.tienda') === 'https://www.instagram.com/mi.tienda'
    && normalizeSocial('tiktok', 'mitienda') === 'https://www.tiktok.com/@mitienda' && normalizeSocial('x', '@mitienda') === 'https://x.com/mitienda'
    && normalizeSocial('youtube', '@mitienda') === 'https://www.youtube.com/@mitienda' && normalizeSocial('facebook', 'mitienda.cr') === 'https://www.facebook.com/mitienda.cr');
  t.check('link -> link canónico (sin query ni rastreo)', normalizeSocial('instagram', 'https://instagram.com/mitienda/?igsh=abc') === 'https://www.instagram.com/mitienda'
    && normalizeSocial('x', 'twitter.com/mitienda') === 'https://x.com/mitienda' && normalizeSocial('website', 'mitienda.com') === 'https://mitienda.com/');
  t.check('rechaza javascript:, data:, http: y otros esquemas', ['javascript:alert(1)', 'data:text/html,hi', 'http://instagram.com/x', 'mailto:a@b.com', 'JavaScript://instagram.com/%0aalert(1)']
    .every((v) => normalizeSocial('instagram', v) === 'invalid' && normalizeSocial('website', v) === 'invalid'));
  t.check('rechaza otro dominio y dominios parecidos', normalizeSocial('instagram', 'https://evil.com/mitienda') === 'invalid'
    && normalizeSocial('facebook', 'https://facebook.com.evil.com/x') === 'invalid' && normalizeSocial('x', 'https://user:pw@x.com/a') === 'invalid');
  t.check('largo máximo', normalizeSocial('website', 'https://a.com/' + 'a'.repeat(200)) === 'invalid' && normalizeSocial('x', 'a'.repeat(16)) === 'invalid');
  const r = normalizeSocials({ instagram: 'mitienda', website: '', youtube: null });
  t.check('objeto: solo las redes con valor; clave desconocida o red inválida -> error', 'socials' in r && JSON.stringify(r.socials) === '{"instagram":"https://www.instagram.com/mitienda"}'
    && 'bad' in normalizeSocials({ whatsapp: '8888' }) && (normalizeSocials({ tiktok: 'javascript:x' }) as any).bad === 'tiktok');
  t.check('lo guardado se vuelve a limpiar al leer', JSON.stringify(cleanSocials({ x: 'javascript:alert(1)', website: 'https://ok.cr/' })) === '{"website":"https://ok.cr/"}');
}
