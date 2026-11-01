// Solo iOS/Android (metro.config.js): el paquete "eventsource" que trae @stellar/stellar-sdk es de Node (require('url'),
// 'http', 'https') y rompe el bundle nativo. La app no usa streaming de Horizon (.stream()), así que basta un stub.
// La web no lo usa: allí stellar-sdk resuelve a su build de navegador.
class EventSourceUnavailable {
  constructor() { throw new Error('EventSource no está disponible en la app nativa'); }
}
module.exports = EventSourceUnavailable;
module.exports.default = EventSourceUnavailable;
