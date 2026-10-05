import unittest
from datetime import date, datetime, timezone
from decimal import Decimal as D

from cryptotax.engine import Config, Engine
from cryptotax.models import Event, Kind
from cryptotax.prices import FxTable, PriceBook
from cryptotax.rules import rules_for
from cryptotax.rw import compute_rw
from cryptotax.tax import baskets_for_year, round_euro

_n = 0


def T(y, m, d, h=12, mi=0):
    return datetime(y, m, d, h, mi, tzinfo=timezone.utc)


def ev(kind, ts, asset="", qty="0", **kw):
    global _n
    _n += 1
    for k in ("qty", "counter_qty", "value", "fee_qty", "fee_value"):
        if k == "qty":
            continue
        if k in kw and kw[k] is not None:
            kw[k] = D(str(kw[k]))
    return Event(uid=kw.pop("uid", f"e{_n}"), ts=ts, account=kw.pop("account", "app"), kind=kind,
                 asset=asset, qty=D(str(qty)), **kw)


def run(events, year=2025, prices=None, fx=None, **cfgkw):
    cfg = Config(target_year=year, **cfgkw)
    e = Engine(cfg, prices or PriceBook(), fx or FxTable()).run(events)
    return e, baskets_for_year(e, rules_for(year), year, cfgkw.pop("carryforward", {}))


def blocking(engine):
    return [i for i in engine.issues if i.level == "block"]


class LifoTests(unittest.TestCase):
    def test_lifo_two_lots(self):
        evs = [
            ev(Kind.BUY, T(2024, 1, 10), "BTC", 1, value=100),
            ev(Kind.BUY, T(2024, 6, 1), "BTC", 1, value=200),
            ev(Kind.SELL, T(2025, 3, 1), "BTC", "1.5", value=450),
        ]
        e, (crypto, metals) = run(evs)
        d = e.disposals[0]
        self.assertEqual(d.cost, D(250))            # 1 x 200 (ultimo lotto) + 0.5 x 100
        self.assertEqual(d.gain, D(200))
        self.assertEqual(crypto.tax, D(52))
        self.assertEqual(blocking(e), [])

    def test_fee_in_fiat_adjusts_cost_and_proceeds(self):
        evs = [
            ev(Kind.BUY, T(2025, 1, 5), "BTC", 1, value=100, fee_qty=2, fee_asset="EUR"),
            ev(Kind.SELL, T(2025, 2, 5), "BTC", 1, value=150, fee_qty=3, fee_asset="EUR"),
        ]
        e, (crypto, _) = run(evs, fx=_eur_fx())
        d = e.disposals[0]
        self.assertEqual(d.cost, D(102))
        self.assertEqual(d.proceeds, D(147))
        self.assertEqual(d.gain, D(45))

    def test_missing_history_blocks_and_costs_zero(self):
        e, (crypto, _) = run([ev(Kind.SELL, T(2025, 2, 5), "BTC", 1, value=150)])
        self.assertEqual(e.disposals[0].gain, D(150))
        self.assertIn("missing_history", [i.code for i in blocking(e)])


class SwapTests(unittest.TestCase):
    def test_swap_then_sell(self):
        evs = [
            ev(Kind.BUY, T(2025, 1, 10), "ETH", 1, value=1000),
            ev(Kind.SWAP, T(2025, 2, 1), "ETH", 1, counter_asset="BTC", counter_qty="0.05", value=1500),
            ev(Kind.SELL, T(2025, 3, 1), "BTC", "0.05", value=1400),
        ]
        e, (crypto, _) = run(evs)
        gains = [d.gain for d in e.disposals]
        self.assertEqual(gains, [D(500), D(-100)])
        self.assertEqual(crypto.net, D(400))
        self.assertEqual(crypto.tax, D(104))

    def test_swap_without_price_blocks(self):
        evs = [ev(Kind.BUY, T(2025, 1, 10), "ETH", 1, value=1000),
               ev(Kind.SWAP, T(2025, 2, 1), "ETH", 1, counter_asset="BTC", counter_qty="0.05")]
        e, _ = run(evs)
        self.assertIn("missing_value", [i.code for i in blocking(e)])
        self.assertIn(("ETH", "2025-02-01"), e.missing_prices)

    def test_swap_uses_pricebook(self):
        pb = PriceBook()
        pb.add("ETH", date(2025, 2, 1), D(1600))
        evs = [ev(Kind.BUY, T(2025, 1, 10), "ETH", 1, value=1000),
               ev(Kind.SWAP, T(2025, 2, 1), "ETH", 1, counter_asset="BTC", counter_qty="0.05")]
        e, _ = run(evs, prices=pb)
        self.assertEqual(blocking(e), [])
        self.assertEqual(e.disposals[0].gain, D(600))

    def test_fee_in_crypto_is_accessory_cost_and_disposal(self):
        pb = PriceBook()
        pb.add("CRO", date(2025, 2, 1), D("0.10"))
        evs = [
            ev(Kind.BUY, T(2025, 1, 1), "CRO", 100, value=5),                 # costo 0.05 cad.
            ev(Kind.BUY, T(2025, 1, 10), "ETH", 1, value=1000),
            ev(Kind.SWAP, T(2025, 2, 1), "ETH", 1, counter_asset="BTC", counter_qty="0.05", value=1500,
               fee_asset="CRO", fee_qty=10),                                  # commissione 10 CRO = 1 EUR
        ]
        e, _ = run(evs, prices=pb)
        swap = [d for d in e.disposals if d.kind == "swap"][0]
        fee = [d for d in e.disposals if d.kind == "fee"][0]
        self.assertEqual(swap.proceeds, D(1499))      # 1500 - 1 di commissione
        self.assertEqual(fee.proceeds, D(1))
        self.assertEqual(fee.cost, D("0.5"))          # 10 CRO a 0.05
        self.assertEqual(fee.gain, D("0.5"))


class BasketTests(unittest.TestCase):
    def _gain(self, amount):
        return [ev(Kind.BUY, T(2025, 1, 1), "BTC", 1, value=1000),
                ev(Kind.SELL, T(2025, 2, 1), "BTC", 1, value=1000 + amount)]

    def test_carryforward_used_oldest_first_and_expiry(self):
        e = Engine(Config(2025), PriceBook(), FxTable()).run(self._gain(1000))
        b = baskets_for_year(e, rules_for(2025), 2025,
                             {"crypto": [(2024, "300"), (2020, "999"), (2021, "200")]})[0]
        self.assertEqual(b.carry_used, [(2021, D(200)), (2024, D(300))])   # il 2020 e' scaduto
        self.assertEqual(b.carry_expired, [(2020, D(999))])
        self.assertEqual(b.taxable, D(500))
        self.assertEqual(b.tax, D(130))

    def test_loss_year_creates_carry_and_no_tax(self):
        e = Engine(Config(2025), PriceBook(), FxTable()).run(self._gain(-250))
        b = baskets_for_year(e, rules_for(2025), 2025, {"crypto": [(2024, "100")]})[0]
        self.assertEqual(b.new_loss, D(250))
        self.assertEqual(b.tax, D(0))
        self.assertEqual(b.carry_unused, [(2024, D(100))])

    def test_income_not_offset_by_losses(self):
        evs = self._gain(-50) + [ev(Kind.INCOME, T(2025, 3, 1), "ADA", 10, value=100, income_type="staking")]
        e = Engine(Config(2025), PriceBook(), FxTable()).run(evs)
        b = baskets_for_year(e, rules_for(2025), 2025, {})[0]
        self.assertEqual(b.income, D(100))
        self.assertEqual(b.taxable, D(100))
        self.assertEqual(b.tax, D(26))
        # il valore normale diventa costo del lotto
        self.assertEqual(e.pools["ADA"].lots[0].unit_cost, D(10))

    def test_metals_separate_from_crypto(self):
        evs = [
            ev(Kind.BUY, T(2025, 1, 1), "BTC", 1, value=1000),
            ev(Kind.SELL, T(2025, 2, 1), "BTC", 1, value=700),                       # -300 cripto
            ev(Kind.BUY, T(2025, 1, 5), "XAU", 10, value=500, asset_hint="Metal"),
            ev(Kind.SELL, T(2025, 3, 5), "XAU", 5, value=350, asset_hint="Metal"),   # +100 oro
        ]
        e = Engine(Config(2025), PriceBook(), FxTable()).run(evs)
        crypto, metals = baskets_for_year(e, rules_for(2025), 2025, {})
        self.assertEqual(crypto.net, D(-300))
        self.assertEqual(metals.net, D(100))
        self.assertEqual(metals.tax, D(26))        # nessuna compensazione con la minus cripto

    def test_year_boundary_uses_italian_date(self):
        evs = [ev(Kind.BUY, T(2025, 1, 1), "BTC", 1, value=100),
               ev(Kind.SELL, T(2025, 12, 31, 23, 30), "BTC", 1, value=200)]   # 00:30 del 1/1/2026 in Italia
        e = Engine(Config(2025), PriceBook(), FxTable()).run(evs)
        crypto, _ = baskets_for_year(e, rules_for(2025), 2025, {})
        self.assertEqual(crypto.n_disposals, 0)

    def test_round_euro_half_up(self):
        self.assertEqual(round_euro(D("10.5")), D(11))
        self.assertEqual(round_euro(D("10.49")), D(10))

    def test_pre_2025_not_supported(self):
        e = Engine(Config(2024), PriceBook(), FxTable())
        with self.assertRaises(NotImplementedError):
            baskets_for_year(e, rules_for(2024), 2024, {})


class TransferTests(unittest.TestCase):
    def test_matched_transfer_with_fee(self):
        pb = PriceBook()
        pb.add("BTC", date(2025, 2, 1), D(100000))
        evs = [
            ev(Kind.BUY, T(2025, 1, 1), "BTC", 1, value=50000, account="app"),
            ev(Kind.TRANSFER_OUT, T(2025, 2, 1, 10), "BTC", 1, account="app"),
            ev(Kind.TRANSFER_IN, T(2025, 2, 1, 11), "BTC", "0.9995", account="exchange"),
        ]
        e = Engine(Config(2025), pb, FxTable()).run(evs)
        self.assertEqual(blocking(e), [])
        fee = e.disposals[0]
        self.assertEqual(fee.kind, "transfer_fee")
        self.assertEqual(fee.qty, D("0.0005"))
        self.assertEqual(fee.proceeds, D(50))
        self.assertEqual(fee.cost, D(25))
        self.assertEqual(e.pools["BTC"].balance, D("0.9995"))

    def test_unmatched_in_blocks_then_resolution(self):
        evs = [ev(Kind.TRANSFER_IN, T(2025, 2, 1), "BTC", 1, account="app", uid="X1"),
               ev(Kind.SELL, T(2025, 3, 1), "BTC", 1, value=100, account="app")]
        e = Engine(Config(2025), PriceBook(), FxTable()).run(evs)
        self.assertIn("transfer_in_unmatched", [i.code for i in blocking(e)])
        self.assertEqual(e.disposals[0].gain, D(100))
        e2 = Engine(Config(2025, resolutions={"X1": {"action": "set_cost", "cost_eur": "40", "acquired": "2023-05-01"}}),
                    PriceBook(), FxTable()).run(evs)
        self.assertEqual(blocking(e2), [])
        self.assertEqual(e2.disposals[0].gain, D(60))

    def test_unmatched_out_defaults_to_self_custody_with_block(self):
        evs = [ev(Kind.BUY, T(2025, 1, 1), "BTC", 1, value=100),
               ev(Kind.TRANSFER_OUT, T(2025, 2, 1), "BTC", 1, uid="O1")]
        e = Engine(Config(2025), PriceBook(), FxTable()).run(evs)
        self.assertIn("transfer_out_unmatched", [i.code for i in blocking(e)])
        self.assertEqual(e.disposals, [])
        e2 = Engine(Config(2025, resolutions={"O1": {"action": "self_custody"}}), PriceBook(), FxTable()).run(evs)
        self.assertEqual(blocking(e2), [])

    def test_unmatched_out_as_disposal(self):
        evs = [ev(Kind.BUY, T(2025, 1, 1), "BTC", 1, value=100),
               ev(Kind.TRANSFER_OUT, T(2025, 2, 1), "BTC", 1, uid="O1")]
        e = Engine(Config(2025, resolutions={"O1": {"action": "disposal", "value_eur": "130"}}),
                   PriceBook(), FxTable()).run(evs)
        self.assertEqual(e.disposals[0].gain, D(30))


class RebaseTests(unittest.TestCase):
    def test_rebase_replaces_cost_with_value_at_1_1_2025(self):
        pb = PriceBook()
        pb.add("BTC", date(2025, 1, 1), D(300))
        evs = [ev(Kind.BUY, T(2023, 5, 1), "BTC", 1, value=100),
               ev(Kind.SELL, T(2025, 6, 1), "BTC", 1, value=350)]
        e = Engine(Config(2025, rebase_1_1_2025=True), pb, FxTable()).run(evs)
        self.assertEqual(e.disposals[0].gain, D(50))
        self.assertTrue(e.disposals[0].uses[0].rebased)
        self.assertEqual(e.rebase_total_value, D(300))

    def test_rebase_missing_price_blocks(self):
        evs = [ev(Kind.BUY, T(2023, 5, 1), "BTC", 1, value=100)]
        e = Engine(Config(2025, rebase_1_1_2025=True), PriceBook(), FxTable()).run(evs)
        self.assertIn("missing_rebase_price", [i.code for i in blocking(e)])


class RwTests(unittest.TestCase):
    def test_held_all_year(self):
        pb = PriceBook()
        pb.add("BTC", date(2025, 1, 1), D(100))
        pb.add("BTC", date(2025, 12, 31), D(200))
        evs = [ev(Kind.BUY, T(2024, 5, 1), "BTC", 2, value=100, account="app")]
        e = Engine(Config(2025), pb, FxTable()).run(evs)
        rows = compute_rw(e, rules_for(2025), 2025)
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertEqual((r.days, r.value_initial, r.value_final), (365, D(200), D(400)))
        self.assertEqual(r.ivca, D("0.002") * D(400))

    def test_bought_and_sold_within_year(self):
        evs = [ev(Kind.BUY, T(2025, 3, 1), "BTC", 1, value=100, account="app"),
               ev(Kind.SELL, T(2025, 3, 10), "BTC", 1, value=130, account="app")]
        e = Engine(Config(2025), PriceBook(), FxTable()).run(evs)
        r = compute_rw(e, rules_for(2025), 2025)[0]
        self.assertEqual(r.days, 10)                       # 1..10 marzo compresi
        self.assertEqual((r.value_initial, r.value_final), (D(100), D(130)))
        self.assertEqual(r.qty_end, D(0))

    def test_missing_year_end_price_blocks(self):
        evs = [ev(Kind.BUY, T(2025, 3, 1), "BTC", 1, value=100, account="app")]
        e = Engine(Config(2025), PriceBook(), FxTable()).run(evs)
        compute_rw(e, rules_for(2025), 2025)
        self.assertIn("rw_missing_price", [i.code for i in blocking(e)])
        self.assertIn(("BTC", "2025-12-31"), e.missing_prices)

    def test_metal_has_no_ivca(self):
        pb = PriceBook()
        pb.add("XAU", date(2025, 12, 31), D(80))
        evs = [ev(Kind.BUY, T(2025, 3, 1), "XAU", 10, value=500, account="bitpanda", asset_hint="Metal")]
        e = Engine(Config(2025), pb, FxTable()).run(evs)
        r = compute_rw(e, rules_for(2025), 2025)[0]
        self.assertEqual(r.ivca, D(0))
        self.assertEqual(r.value_final, D(800))


def _eur_fx():
    return FxTable()


if __name__ == "__main__":
    unittest.main()
