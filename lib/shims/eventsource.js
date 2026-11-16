// Stub de eventsource para iOS/Android: el stellar-sdk lo exige al empaquetar Horizon,
// pero en nativo no usamos el streaming. En web se sigue resolviendo el paquete real.
function EventSource() {
  this.readyState = EventSource.CLOSED;
  this.close = function () {};
  this.addEventListener = function () {};
  this.removeEventListener = function () {};
  this.onerror = null;
  this.onmessage = null;
  this.onopen = null;
}
EventSource.CONNECTING = 0;
EventSource.OPEN = 1;
EventSource.CLOSED = 2;
module.exports = EventSource;
module.exports.EventSource = EventSource;
