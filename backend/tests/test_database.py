"""Smoke tests and example decision-layer queries for the Viseca database.

Run from the repository root:
    python -m unittest discover -s tests
"""
from __future__ import annotations

import sqlite3
import tempfile
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "database"))
from build_database import DEFAULT_DATA, build


class VisecaDatabaseQueriesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.database = Path(cls.temp_dir.name) / 'viseca_test.db'
        build(DEFAULT_DATA, cls.database)
        cls.db = sqlite3.connect(cls.database)
        cls.db.row_factory = sqlite3.Row

    @classmethod
    def tearDownClass(cls) -> None:
        cls.db.close()
        cls.temp_dir.cleanup()

    def test_expected_source_row_counts(self) -> None:
        self.assertEqual(self.db.execute('SELECT count(*) FROM customers').fetchone()[0], 20)
        self.assertEqual(self.db.execute('SELECT count(*) FROM authorization_history').fetchone()[0], 4701)
        self.assertEqual(self.db.execute('SELECT count(*) FROM purchase_attempts').fetchone()[0], 45)

    def test_replay_a_scenario_in_delivery_order(self) -> None:
        """The query used to fetch requests one by one for an offline replay."""
        rows = self.db.execute("""
            SELECT authorization_id, replay_order, billing_amount_chf,
                   merchant_name, cardholder_instruction
            FROM scenario_purchase_context
            WHERE scenario_id = ?
            ORDER BY replay_order
        """, ('SCEN0001',)).fetchall()
        self.assertEqual(len(rows), 10)
        self.assertEqual([row['replay_order'] for row in rows], list(range(1, 11)))
        self.assertTrue(all(row['cardholder_instruction'] for row in rows))

    def test_fetch_cart_for_authorization(self) -> None:
        """Example of the low-latency cart query before making a decision."""
        cart = self.db.execute("""
            SELECT line_no, item_id, item_name, item_category, quantity, unit_price,
                   currency, item_details
            FROM purchase_attempt_items
            WHERE authorization_id = ?
            ORDER BY line_no
        """, ('AU0002',)).fetchall()
        self.assertEqual(len(cart), 2)
        self.assertEqual(cart[0]['item_category'], 'groceries')

    def test_get_familiar_merchants_for_card(self) -> None:
        """Approved merchant frequency is a useful familiarity signal."""
        familiar = self.db.execute("""
            SELECT merchant_id, merchant_name, count(*) AS approved_count,
                   max(timestamp) AS last_approved_at
            FROM authorization_history
            WHERE card_id = ? AND status = 'approved'
            GROUP BY merchant_id, merchant_name
            ORDER BY approved_count DESC, last_approved_at DESC
            LIMIT 5
        """, ('CA0001',)).fetchall()
        self.assertGreater(len(familiar), 0)
        self.assertGreater(familiar[0]['approved_count'], 0)

    def test_card_history_query_uses_index(self) -> None:
        """Protect the intended fast path from accidental index removal."""
        plan = self.db.execute("""
            EXPLAIN QUERY PLAN
            SELECT authorization_id, timestamp, billing_amount_chf
            FROM authorization_history
            WHERE card_id = ?
            ORDER BY timestamp DESC LIMIT 20
        """, ('CA0001',)).fetchall()
        self.assertTrue(any('idx_history_card_time' in row[3] for row in plan), plan)

    def test_database_integrity(self) -> None:
        self.assertEqual(self.db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(), [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
