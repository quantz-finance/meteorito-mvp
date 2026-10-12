// Debe importarse ANTES del SDK de Cavos/Stellar: en web no existe Buffer global ("Buffer is not defined" en signMessage).
import { Buffer } from 'buffer';
if (typeof (globalThis as any).Buffer === 'undefined') (globalThis as any).Buffer = Buffer;
