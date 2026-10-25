// Animaciones web en CSS puro (sin JS por frame): solo transform/opacity, 180–350 ms, ease-out tipo spring.
// Se activan con dataSet={{ anim: '<nombre>' }} (react-native-web lo pasa como data-anim). La celebración es la única > 350 ms.
// prefers-reduced-motion: todo queda en 1 ms (sin movimiento), el contenido aparece igual.
import { Platform } from 'react-native';
import { appearCss } from '@/lib/appearCore';

export const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
export const SPRING = 'cubic-bezier(0.34, 1.4, 0.64, 1)';

/** Props para animar en web; en nativo no hace nada. */
export const anim = (name: string): object => (Platform.OS === 'web' ? { dataSet: { anim: name } } : {});
/** Transición suave de presión (scale/opacity) en web. */
export const pressTransition: object = Platform.OS === 'web'
  ? { transitionProperty: 'transform, opacity', transitionDuration: '140ms', transitionTimingFunction: EASE_OUT } : {};

const confetti = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2, d = 70 + (i % 3) * 26;
  const x = Math.round(Math.cos(a) * d), y = Math.round(Math.sin(a) * d * 0.8 - 30);
  const colors = ['#FF8A3D', '#FFD84D', '#B794FF', '#5BE3A1'];
  return `[data-anim="confetti"]>div:nth-child(${i + 1}){--x:${x}px;--y:${y}px;--r:${(i * 47) % 360}deg;background:${colors[i % 4]};animation-delay:${(i % 4) * 25}ms}`;
}).join('');

export const MOTION_CSS = `${appearCss()}
@keyframes m-enter{from{opacity:0;transform:translate3d(0,10px,0)}to{opacity:1;transform:none}}
@keyframes m-fade{from{opacity:0}to{opacity:1}}
@keyframes m-sheet{from{transform:translate3d(0,100%,0)}to{transform:none}}
@keyframes m-pop{0%{opacity:0;transform:scale(.6)}100%{opacity:1;transform:scale(1)}}
@keyframes m-swap{0%{opacity:0;transform:scale(.85)}60%{opacity:1;transform:scale(1.08)}100%{transform:scale(1)}}
@keyframes m-ring{0%{opacity:.55;transform:scale(1)}100%{opacity:0;transform:scale(1.9)}}
@keyframes m-pulse{0%,100%{opacity:.45}50%{opacity:.9}}
@keyframes m-toast{from{opacity:0;transform:translate3d(0,-16px,0) scale(.98)}to{opacity:1;transform:none}}
@keyframes m-confetti{0%{opacity:1;transform:translate3d(0,0,0) rotate(0) scale(1)}100%{opacity:0;transform:translate3d(var(--x),var(--y),0) rotate(var(--r)) scale(.6)}}
[data-anim="enter"]{animation:m-enter 280ms ${EASE_OUT} both}
[data-anim="fade"]{animation:m-fade 200ms ease-out both}
[data-anim="sheet"]{animation:m-sheet 320ms ${SPRING} both;will-change:transform}
[data-anim="pop"]{animation:m-pop 300ms ${SPRING} both}
[data-anim="check"]{animation:m-pop 280ms ${SPRING} 120ms both}
[data-anim="swap"]{animation:m-swap 320ms ${EASE_OUT} both}
[data-anim="ring"]{animation:m-ring 900ms ease-out 2;pointer-events:none}
[data-anim="skeleton"]{animation:m-pulse 1400ms ease-in-out infinite}
[data-anim="toast"]{animation:m-toast 260ms ${EASE_OUT} both}
@keyframes m-dot{0%,70%,100%{opacity:.35;transform:none}35%{opacity:1;transform:translate3d(0,-3px,0)}}
[data-anim="dot"]{animation:m-dot 1.1s ease-in-out infinite}
[data-anim="dot"]:nth-child(2){animation-delay:.15s}
[data-anim="dot"]:nth-child(3){animation-delay:.3s}
@keyframes m-msg{from{opacity:0;transform:translate3d(0,8px,0) scale(.98)}to{opacity:1;transform:none}}
[data-anim="msg"]{animation:m-msg 200ms ${EASE_OUT} both}
@keyframes m-dive{0%,100%{transform:none}50%{transform:translate(2.5%,3%) rotate(3deg)}}
@keyframes m-f1{0%,100%{transform:none}50%{transform:scaleX(1.08) scaleY(.9) translateY(3.75%)}}
@keyframes m-f2{0%,100%{transform:none}50%{transform:scaleX(1.15) scaleY(1.1) translateY(-7.7%)}}
@keyframes m-f3{0%,100%{transform:none}50%{transform:scaleX(.9) scaleY(1.12) translateY(8.3%)}}
[data-anim="dive"]{animation:m-dive 4s ease-in-out infinite}
@keyframes m-bob{0%,100%{transform:translate3d(0,0,0) rotate(-3deg)}50%{transform:translate3d(0,-5px,0) rotate(2deg)}}
[data-anim="bob"]{animation:m-bob 3.6s ease-in-out infinite}
[data-anim="f1"]{animation:m-f1 .8s ease-in-out infinite}
[data-anim="f2"]{animation:m-f2 1s ease-in-out infinite}
[data-anim="f3"]{animation:m-f3 .8s ease-in-out -.4s infinite}
html.bg-hidden [data-anim]{animation-play-state:paused}
[data-anim="confetti"]{pointer-events:none}
[data-anim="confetti"]>div{position:absolute;left:50%;top:50%;width:8px;height:8px;border-radius:2px;opacity:0;animation:m-confetti 900ms ${EASE_OUT} forwards}
${confetti}
@media (prefers-reduced-motion: reduce){[data-anim]{animation-duration:1ms!important;animation-delay:0ms!important;animation-iteration-count:1!important}[data-anim="ring"],[data-anim="confetti"]{display:none}*{transition-duration:1ms!important}}
`.replace(/\n/g, '');
