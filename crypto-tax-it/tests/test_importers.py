"""I file di prova sono SINTETICI e seguono la struttura ASSUNTA dagli importatori: questi test verificano che il
codice faccia cio' che si intende, NON che i formati reali di Crypto.com/Bitpanda coincidano.
La validazione sui formati reali richiede gli export veri (vedi README, comando `inspect`)."""
import contextlib
import io
import json
import tempfile
import unittest
from decimal import Decimal as D
from pathlib import Path

from cryptotax import cli
from cryptotax.importers import bitpanda, cryptocom_app, cryptocom_exchange
from cryptotax.importers.base import ImportFormatError, parse_decimal
from cryptotax.models import Kind

APP_CSV = """Timestamp (UTC),Transaction Description,Currency,Amount,To Currency,To Amount,Native Currency,Native Amount,Native Amount (in USD),Transaction Kind
2025-01-10 10:00:00,Buy BTC,EUR,-1000,BTC,0.01,EUR,1000,1100,viban_purchase
2025-02-01 10:00:00,BTC -> ETH,BTC,-0.01,ETH,0.2,EUR,1200,1300,crypto_exchange
2025-03-01 10:00:00,Sell ETH,ETH,-0.2,EUR,1300,EUR,1300,1400,crypto_viban_exchange
2025-03-05 10:00:00,Earn,CRO,5,,,EUR,0.5,0.55,crypto_earn_interest_paid
2025-03-06 10:00:00,Lock,CRO,-5,,,EUR,0.5,0.55,crypto_earn_program_created
2025-03-07 10:00:00,To exchange,CRO,-5,,,EUR,0.5,0.55,crypto_to_exchange_transfer
2025-03-08 10:00:00,Mystery,CRO,1,,,EUR,0.1,0.11,foo_bar_baz
"""

BITPANDA_CSV = """Bitpanda Customer Name
Export generato il 2025-12-31
,
Transaction ID,Timestamp,Transaction Type,In/Out,Amount Fiat,Fiat,Amount Asset,Asset,Asset market price,Asset market price currency,Asset class,Product ID,Fee,Fee asset,Spread,Spread Currency
T1,2025-01-05T09:00:00+01:00,deposit,incoming,500.00,EUR,500.00,EUR,,,Fiat,,0,EUR,,
T2,2025-01-05T09:05:00+01:00,buy,incoming,500.00,EUR,10.0,XAU,50,EUR,Metal,,5.00,EUR,0,EUR
T3,2025-03-05T09:05:00+01:00,sell,outgoing,350.00,EUR,5.0,XAU,70,EUR,Metal,,3.00,EUR,0,EUR
T4,2025-03-06T09:05:00+01:00,mystery,outgoing,1,EUR,1,XAU,70,EUR,Metal,,0,EUR,0,EUR
"""

EXCH_TRADES = """Trade Date,Instrument,Side,Quantity,Price,Fee,Fee Currency,Margin Order
2025-01-10 10:00:00,BTC_EUR,BUY,0.01,100000,1,EUR,False
2025-02-10 10:00:00,CRO_USDT,SELL,100,0.12,0.012,USDT,False
2025-02-11 10:00:00,ETH_EUR,BUY,1,3000,1,EUR,True
"""


def write(dirpath, name, text):
    p = Path(dirpath) / name
    p.write_text(text, encoding="utf-8")
    return p


class ParseDecimalTests(unittest.TestCase):
    def test_variants(self):
        self.assertEqual(parse_decimal("1,234.56"), D("1234.56"))
        self.assertEqual(parse_decimal("1.234,56"), D("1234.56"))
        self.assertEqual(parse_decimal("1,5"), D("1.5"))
        self.assertEqual(parse_decimal("-0.0001"), D("-0.0001"))
        self.assertIsNone(parse_decimal(""))
        with self.assertRaises(ImportFormatError):
            parse_decimal("abc")


class CryptoComAppTests(unittest.TestCase):
    def test_kinds(self):
        with tempfile.TemporaryDirectory() as d:
            res = cryptocom_app.parse(write(d, "app.csv", APP_CSV))
        k = [e.kind for e in res.events]
        self.assertEqual(k, [Kind.BUY, Kind.SWAP, Kind.SELL, Kind.INCOME, Kind.INFO, Kind.TRANSFER_OUT, Kind.UNRESOLVED])
        buy, swap, sell, income = res.events[:4]
        self.assertEqual((buy.asset, buy.qty, buy.value, buy.value_ccy), ("BTC", D("0.01"), D(1000), "EUR"))
        self.assertEqual((swap.asset, swap.qty, swap.counter_asset, swap.counter_qty, swap.value),
                         ("BTC", D("0.01"), "ETH", D("0.2"), D(1200)))
        self.assertEqual((sell.asset, sell.qty, sell.value), ("ETH", D("0.2"), D(1300)))
        self.assertEqual((income.income_type, income.value), ("interest", D("0.5")))
        self.assertIn("foo_bar_baz", res.events[-1].note)

    def test_missing_columns(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ImportFormatError):
                cryptocom_app.parse(write(d, "x.csv", "a,b,c\n1,2,3\n"))


class BitpandaTests(unittest.TestCase):
    def test_preamble_and_gold(self):
        with tempfile.TemporaryDirectory() as d:
            res = bitpanda.parse(write(d, "bp.csv", BITPANDA_CSV))
        k = [e.kind for e in res.events]
        self.assertEqual(k, [Kind.FIAT_IN, Kind.BUY, Kind.SELL, Kind.UNRESOLVED])
        buy, sell = res.events[1], res.events[2]
        self.assertEqual((buy.asset, buy.qty, buy.value, buy.asset_hint), ("XAU", D(10), D(500), "Metal"))
        self.assertEqual((sell.asset, sell.qty, sell.value), ("XAU", D(5), D(350)))
        self.assertEqual(buy.ts.isoformat(), "2025-01-05T08:05:00+00:00")   # 09:05+01:00 -> UTC


class ExchangeTests(unittest.TestCase):
    def test_trades(self):
        with tempfile.TemporaryDirectory() as d:
            res = cryptocom_exchange.parse_trades(write(d, "t.csv", EXCH_TRADES))
        k = [e.kind for e in res.events]
        self.assertEqual(k, [Kind.BUY, Kind.SWAP, Kind.UNRESOLVED])
        buy, swap = res.events[:2]
        self.assertEqual((buy.asset, buy.qty, buy.value, buy.fee_qty, buy.fee_asset), ("BTC", D("0.01"), D(1000), D(1), "EUR"))
        self.assertEqual((swap.asset, swap.counter_asset, swap.counter_qty), ("CRO", "USDT", D(12)))
        self.assertIn("margine", res.events[2].note)

    def test_unknown_headers_fail_loudly(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ImportFormatError):
                cryptocom_exchange.parse_trades(write(d, "t.csv", "Foo,Bar\n1,2\n"))

    def test_split_pair(self):
        self.assertEqual(cryptocom_exchange.split_pair("BTC_EUR"), ("BTC", "EUR"))
        self.assertEqual(cryptocom_exchange.split_pair("BTC/USDT"), ("BTC", "USDT"))
        self.assertEqual(cryptocom_exchange.split_pair("ETHUSDC"), ("ETH", "USDC"))


class EndToEndTests(unittest.TestCase):
    def test_cli_run_and_inspect(self):
        with tempfile.TemporaryDirectory() as d:
            write(d, "app.csv", APP_CSV)
            write(d, "bp.csv", BITPANDA_CSV)
            write(d, "prices.csv", "date,symbol,eur_price\n2025-01-01,BTC,100000\n2025-12-31,BTC,100000\n")
            write(d, "config.json", json.dumps({
                "year": 2025,
                "sources": [{"type": "cryptocom_app", "path": "app.csv", "account": "cryptocom_app"},
                            {"type": "bitpanda", "path": "bp.csv", "account": "bitpanda"}],
                "prices_eur": "prices.csv"}))
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                code = cli.main(["run", "--config", str(Path(d) / "config.json")])
            self.assertEqual(code, 2)                      # righe non riconosciute => bloccante
            out = Path(d) / "out"
            for name in ("riepilogo_2025.md", "cessioni_2025.csv", "cessioni_2025_dettaglio_lotti.csv",
                         "proventi_2025.csv", "rw_2025.csv", "problemi.csv", "prezzi_mancanti.csv"):
                self.assertTrue((out / name).exists(), name)
            md = (out / "riepilogo_2025.md").read_text(encoding="utf-8")
            self.assertIn("BOZZA", md)
            problems = (out / "problemi.csv").read_text(encoding="utf-8")
            self.assertIn("unrecognized_row", problems)
            self.assertIn("Transaction Type non riconosciuto: 'mystery'", problems)
            # oro: 10 g a 500 -> vendita 5 g a 350 (fee gia' compresa): plus 100 nel paniere metalli
            self.assertIn("metalli preziosi", md)
            self.assertIn("Plusvalenze: 100.00", md)

            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                self.assertEqual(cli.main(["inspect", str(Path(d) / "bp.csv")]), 0)
            text = buf.getvalue()
            self.assertIn("Transaction Type", text)
            self.assertIn("'mystery'", text)
            self.assertNotIn("350.00", text)               # nessun importo nell'output di inspect


if __name__ == "__main__":
    unittest.main()
