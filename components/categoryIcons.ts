import type { IconName } from '@/components/ds';
const MAP: Record<string, IconName> = {
  celular: 'phone-portrait-outline', consola: 'game-controller-outline', laptop: 'laptop-outline',
  tablet: 'tablet-portrait-outline', camara: 'camera-outline', otro: 'cube-outline',
};
export const categoryIcon = (id: string): IconName => MAP[id] ?? 'cube-outline';
