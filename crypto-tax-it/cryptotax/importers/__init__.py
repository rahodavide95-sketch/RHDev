from . import bitpanda, cryptocom_app, cryptocom_exchange

PARSERS = {
    "cryptocom_app": cryptocom_app.parse,
    "cryptocom_exchange_trades": cryptocom_exchange.parse_trades,
    "cryptocom_exchange_transfers": cryptocom_exchange.parse_transfers,
    "bitpanda": bitpanda.parse,
}
